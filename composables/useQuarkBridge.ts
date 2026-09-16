import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from "vue";
import {
  BLOCK_SIZE,
  COMMAND,
  COMMAND_LABELS,
  INPUT_MAGIC,
  BlockReader,
  ProtocolError,
  RESULT,
  responseBlock,
} from "../src/protocol.js";
import {
  createVirtualFileSystem,
  parseRemotePath,
  REMOTE_ROOT,
  toRemotePath,
} from "../src/virtual-fs.js";
import { createRemoteSource } from "../src/remote-source.js";

const USB_VENDOR_ID = 0x057e;
const USB_PRODUCT_ID = 0x3000;
const USB_INTERFACE = 0;
const MAX_TRANSFER_SIZE = 16 * 1024 * 1024;

type ConnectionMode = "idle" | "pending" | "online";
type SelectionKind = "file" | "folder" | "url";
type ActivityKind = "" | "success" | "warning" | "error" | "muted";
type EndpointDirection = "in" | "out";

type BridgeFile = {
  name: string;
  size: number;
  relativePath?: string;
  webkitRelativePath?: string;
  slice?: (start?: number, end?: number, contentType?: string) => Blob;
  read?: (offset: number, length: number) => Promise<Uint8Array>;
};

type UsbTransfer = {
  status: string;
  data?: DataView;
};

type UsbEndpoint = {
  direction: EndpointDirection;
  endpointNumber: number;
};

type UsbInterface = {
  interfaceNumber: number;
  alternates: Array<{ endpoints: UsbEndpoint[] }>;
};

type UsbDevice = {
  configuration: { interfaces: UsbInterface[] } | null;
  serialNumber?: string;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferIn(endpointNumber: number, length: number): Promise<UsbTransfer>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<{ status: string }>;
};

type UsbDisconnectEvent = { device: UsbDevice };

type UsbApi = {
  requestDevice(options: { filters: Array<{ vendorId: number; productId: number }> }): Promise<UsbDevice>;
  addEventListener(type: "disconnect", listener: (event: UsbDisconnectEvent) => void): void;
  removeEventListener(type: "disconnect", listener: (event: UsbDisconnectEvent) => void): void;
};

type NavigatorWithUsb = Navigator & { usb?: UsbApi };

type Activity = {
  id: number;
  message: string;
  kind: ActivityKind;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function errorName(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function rootLabel(files: BridgeFile[], kind: SelectionKind | null) {
  if (kind === "folder") {
    const firstPath = files[0]?.webkitRelativePath || files[0]?.name || "Selected folder";
    return firstPath.split("/")[0] || "Selected folder";
  }
  if (files.length === 1) return files[0].name;
  return `${files.length} files`;
}

export function useQuarkBridge() {
  const connection = reactive({
    mode: "idle" as ConnectionMode,
    label: "Offline",
    badge: "Not linked",
    deviceTitle: "Waiting for Goldleaf",
    deviceDetail: "Choose an NSP file first, then connect the console with Goldleaf open.",
    buttonLabel: "Connect Goldleaf",
    workspaceStatus: "Ready to expose over USB",
  });
  const commandCount = ref(0);
  const activities = ref<Activity[]>([
    { id: 0, message: "Relay is standing by.", kind: "muted" },
  ]);
  const toast = ref("");
  const selectedFiles = shallowRef<BridgeFile[]>([]);
  const selectionKind = ref<SelectionKind | null>(null);
  const virtualFileSystem = shallowRef<ReturnType<typeof createVirtualFileSystem> | null>(null);
  const connected = ref(false);
  const listening = ref(false);
  const device = shallowRef<UsbDevice | null>(null);
  const interfaceNumber = ref(USB_INTERFACE);
  const inEndpoint = ref<number | null>(null);
  const outEndpoint = ref<number | null>(null);

  let activityId = 1;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let usb: UsbApi | null = null;
  let disconnectHandler: ((event: UsbDisconnectEvent) => void) | undefined;

  const hasSelection = computed(() => Boolean(virtualFileSystem.value?.filePaths.length));
  const selectionName = computed(() => rootLabel(selectedFiles.value, selectionKind.value));
  const selectionType = computed(() => (selectionKind.value === "folder" ? "Folder" : selectionKind.value === "url" ? "URL" : "File"));
  const filePaths = computed(() => virtualFileSystem.value?.filePaths || []);
  const visibleFiles = computed(() =>
    filePaths.value.slice(0, 7).map((path) => ({
      path,
      size: formatBytes(Number(virtualFileSystem.value?.getFile(path)?.size || 0)),
    })),
  );
  const fileCount = computed(() => filePaths.value.length);
  const directoryCount = computed(() => virtualFileSystem.value?.directoryPaths.length || 0);
  const totalSize = computed(() => formatBytes(virtualFileSystem.value?.totalBytes() || 0));
  const entryCount = computed(() => filePaths.value.length);
  const commandCountLabel = computed(
    () => `${commandCount.value} command${commandCount.value === 1 ? "" : "s"}`,
  );

  function setConnectionState(mode: ConnectionMode, title: string, detail: string) {
    connection.mode = mode;
    connection.label = mode === "online" ? "Connected" : mode === "pending" ? "Waiting" : "Offline";
    connection.badge = mode === "online" ? "Linked" : mode === "pending" ? "Waiting" : "Not linked";
    connection.deviceTitle = title;
    connection.deviceDetail = detail;
    connection.buttonLabel = mode === "online" ? "Disconnect" : mode === "pending" ? "Waiting for device…" : "Connect Goldleaf";
    connection.workspaceStatus = mode === "online" ? "Visible to Goldleaf" : "Ready to expose over USB";
  }

  function showToast(message: string) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.value = message;
    toastTimer = setTimeout(() => {
      toast.value = "";
    }, 3600);
  }

  function addActivity(message: string, kind: ActivityKind = "") {
    activities.value = [{ id: activityId++, message, kind }, ...activities.value].slice(0, 7);
  }

  function chooseFiles(fileList: FileList | File[] | null, kind: SelectionKind) {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;

    const nspFiles = files.filter((file) => file.name.toLowerCase().endsWith(".nsp"));
    if (!nspFiles.length) {
      addActivity("Selection skipped: choose an .nsp file", "warning");
      showToast("Choose an .nsp file or a folder containing one.");
      return;
    }

    selectedFiles.value = nspFiles;
    selectionKind.value = kind;
    virtualFileSystem.value = createVirtualFileSystem(nspFiles);
    if (nspFiles.length !== files.length) {
      const skipped = files.length - nspFiles.length;
      addActivity(`Skipped ${skipped} non-NSP file${skipped === 1 ? "" : "s"}`, "warning");
    }
    addActivity(`${kind === "folder" ? "NSP folder" : "NSP file"} mounted in browser workspace`, "success");
    showToast(`${kind === "folder" ? "NSP folder" : "NSP file"} ready at ${REMOTE_ROOT}:/`);
  }

  async function addRemoteUrl(url: string, requestedName = "") {
    try {
      const remoteFile = await createRemoteSource(url, requestedName);
      selectedFiles.value = [remoteFile];
      selectionKind.value = "url";
      virtualFileSystem.value = createVirtualFileSystem(selectedFiles.value);
      addActivity(`Remote NSP linked: ${remoteFile.name}`, "success");
      showToast(`Remote NSP ready at ${REMOTE_ROOT}:/`);
    } catch (error) {
      const message = errorMessage(error, "Could not add the remote NSP.");
      addActivity(message, "error");
      showToast(message);
      throw error;
    }
  }

  function clearSelection() {
    selectedFiles.value = [];
    selectionKind.value = null;
    virtualFileSystem.value = null;
    addActivity("Workspace cleared", "muted");
  }

  function ensureFileSystem() {
    if (!virtualFileSystem.value) {
      showToast("Choose an .nsp file or folder before connecting.");
      setConnectionState("idle", "Waiting for an NSP", "The browser workspace is empty.");
      return false;
    }
    return true;
  }

  function safeNumber(value: bigint, label: string) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new ProtocolError(`${label} is outside the browser range`);
    }
    return number;
  }

  async function sendResponse(
    activeDevice: UsbDevice,
    result: number,
    write?: (writer: any) => void,
    payload?: Uint8Array,
  ) {
    if (outEndpoint.value === null) throw new ProtocolError("Goldleaf USB output endpoint is unavailable");
    const responseTransfer = await activeDevice.transferOut(outEndpoint.value, responseBlock(result, write));
    if (responseTransfer.status !== "ok") throw new ProtocolError("USB response transfer failed");
    if (payload?.byteLength) {
      const payloadTransfer = await activeDevice.transferOut(outEndpoint.value, payload);
      if (payloadTransfer.status !== "ok") throw new ProtocolError("USB file transfer failed");
    }
  }

  async function readAndDiscard(activeDevice: UsbDevice, size: number) {
    if (inEndpoint.value === null) throw new ProtocolError("Goldleaf USB input endpoint is unavailable");
    let remaining = size;
    while (remaining > 0) {
      const transfer = await activeDevice.transferIn(inEndpoint.value, Math.min(remaining, 1024 * 1024));
      if (transfer.status !== "ok" || !transfer.data?.byteLength) {
        throw new ProtocolError("Host write payload was interrupted");
      }
      remaining -= transfer.data.byteLength;
    }
  }

  async function handleGetDriveInfo(reader: BlockReader, activeDevice: UsbDevice) {
    const driveIndex = reader.readUint32();
    if (driveIndex !== 0 || !virtualFileSystem.value) {
      await sendResponse(activeDevice, RESULT.INVALID_INDEX);
      return;
    }

    await sendResponse(activeDevice, RESULT.SUCCESS, (writer) => {
      writer.writeString("Browser workspace");
      writer.writeString(REMOTE_ROOT);
      writer.writeUint64(BigInt(virtualFileSystem.value?.totalBytes() || 0));
      writer.writeUint64(0n);
    });
  }

  async function handleStatPath(reader: BlockReader, activeDevice: UsbDevice) {
    const path = parseRemotePath(reader.readString());
    const fileSystem = virtualFileSystem.value;
    if (!fileSystem || path === null) {
      await sendResponse(activeDevice, RESULT.EXCEPTION_CAUGHT);
      return;
    }

    if (fileSystem.isFile(path)) {
      await sendResponse(activeDevice, RESULT.SUCCESS, (writer) => {
        writer.writeUint32(1);
        writer.writeUint64(BigInt(fileSystem.getFile(path)?.size || 0));
      });
    } else if (fileSystem.isDirectory(path)) {
      await sendResponse(activeDevice, RESULT.SUCCESS, (writer) => {
        writer.writeUint32(2);
        writer.writeUint64(0n);
      });
    } else {
      await sendResponse(activeDevice, RESULT.SUCCESS, (writer) => {
        writer.writeUint32(0);
        writer.writeUint64(0n);
      });
    }
  }

  async function handleList(reader: BlockReader, directories: boolean, activeDevice: UsbDevice) {
    const path = parseRemotePath(reader.readString());
    const fileSystem = virtualFileSystem.value;
    if (!fileSystem || path === null || !fileSystem.isDirectory(path)) {
      await sendResponse(activeDevice, RESULT.EXCEPTION_CAUGHT);
      return;
    }

    const entries = directories ? fileSystem.listDirectories(path) : fileSystem.listFiles(path);
    await sendResponse(activeDevice, RESULT.SUCCESS, (writer) => writer.writeUint32(entries.length));
  }

  async function handleListEntry(reader: BlockReader, directories: boolean, activeDevice: UsbDevice) {
    const path = parseRemotePath(reader.readString());
    const index = reader.readUint32();
    const fileSystem = virtualFileSystem.value;
    if (!fileSystem || path === null || !fileSystem.isDirectory(path)) {
      await sendResponse(activeDevice, RESULT.EXCEPTION_CAUGHT);
      return;
    }

    const entries = directories ? fileSystem.listDirectories(path) : fileSystem.listFiles(path);
    if (index >= entries.length) {
      await sendResponse(activeDevice, RESULT.INVALID_INDEX);
      return;
    }
    await sendResponse(activeDevice, RESULT.SUCCESS, (writer) => writer.writeString(entries[index]));
  }

  async function handleStartFile(reader: BlockReader, activeDevice: UsbDevice) {
    const path = parseRemotePath(reader.readString());
    const mode = reader.readUint32();
    if (mode !== 1 && mode !== 2 && mode !== 3) {
      await sendResponse(activeDevice, RESULT.INVALID_FILE_MODE);
      return;
    }

    if (mode === 1 && virtualFileSystem.value?.isFile(path)) {
      await sendResponse(activeDevice, RESULT.SUCCESS);
      return;
    }

    // ponytail: reject host writes; add a user-approved File System Access destination when writes are required.
    await sendResponse(activeDevice, RESULT.EXCEPTION_CAUGHT);
  }

  async function handleReadFile(reader: BlockReader, activeDevice: UsbDevice) {
    const path = parseRemotePath(reader.readString());
    const offset = safeNumber(reader.readUint64(), "Read offset");
    const requestedSize = safeNumber(reader.readUint64(), "Read size");
    const file = path === null ? undefined : virtualFileSystem.value?.getFile(path);

    // ponytail: cap one USB read at 16 MiB, matching Goldleaf's normal work-buffer scale; stream larger requests if that ceiling changes.
    if (!file || requestedSize > MAX_TRANSFER_SIZE) {
      await sendResponse(activeDevice, RESULT.EXCEPTION_CAUGHT);
      return;
    }

    const fileSize = Number(file.size || 0);
    const readSize = Math.max(0, Math.min(requestedSize, fileSize - offset));
    const payload = new Uint8Array(requestedSize);
    if (readSize) {
      const bytes = file.read
        ? await file.read(offset, readSize)
        : new Uint8Array(await file.slice?.(offset, offset + readSize).arrayBuffer());
      if (bytes.byteLength !== readSize) throw new ProtocolError("File read returned an unexpected size");
      payload.set(bytes);
    }

    await sendResponse(activeDevice, RESULT.SUCCESS, (writer) => writer.writeUint64(BigInt(readSize)), payload);
  }

  async function handleWriteFile(reader: BlockReader, activeDevice: UsbDevice) {
    reader.readString();
    await readAndDiscard(activeDevice, safeNumber(reader.readUint64(), "Write size"));
    await sendResponse(activeDevice, RESULT.EXCEPTION_CAUGHT);
  }

  async function handleSelectFile(activeDevice: UsbDevice) {
    if (selectionKind.value === "folder" || !virtualFileSystem.value?.filePaths.length) {
      await sendResponse(activeDevice, RESULT.SELECTION_CANCELLED);
      return;
    }
    await sendResponse(activeDevice, RESULT.SUCCESS, (writer) => writer.writeString(toRemotePath(virtualFileSystem.value?.filePaths[0] || "")));
  }

  async function handleCommand(data: DataView, activeDevice: UsbDevice) {
    let responseSent = false;
    const respond = async (result: number, write?: (writer: any) => void, payload?: Uint8Array) => {
      responseSent = true;
      await sendResponse(activeDevice, result, write, payload);
    };

    try {
      const reader = new BlockReader(data);
      if (reader.readUint32() !== INPUT_MAGIC) throw new ProtocolError("Invalid Goldleaf command magic");

      const commandId = reader.readUint32();
      const commandLabel = COMMAND_LABELS[commandId] || `Unknown command ${commandId}`;
      commandCount.value += 1;
      addActivity(commandLabel, COMMAND_LABELS[commandId] ? "" : "warning");

      switch (commandId) {
        case COMMAND.GET_DRIVE_COUNT:
          await respond(RESULT.SUCCESS, (writer) => writer.writeUint32(virtualFileSystem.value ? 1 : 0));
          break;
        case COMMAND.GET_DRIVE_INFO:
          await handleGetDriveInfo(reader, activeDevice);
          break;
        case COMMAND.STAT_PATH:
          await handleStatPath(reader, activeDevice);
          break;
        case COMMAND.GET_FILE_COUNT:
          await handleList(reader, false, activeDevice);
          break;
        case COMMAND.GET_FILE:
          await handleListEntry(reader, false, activeDevice);
          break;
        case COMMAND.GET_DIRECTORY_COUNT:
          await handleList(reader, true, activeDevice);
          break;
        case COMMAND.GET_DIRECTORY:
          await handleListEntry(reader, true, activeDevice);
          break;
        case COMMAND.START_FILE:
          await handleStartFile(reader, activeDevice);
          break;
        case COMMAND.READ_FILE:
          await handleReadFile(reader, activeDevice);
          break;
        case COMMAND.WRITE_FILE:
          await handleWriteFile(reader, activeDevice);
          break;
        case COMMAND.END_FILE:
          reader.readUint32();
          await respond(RESULT.SUCCESS);
          break;
        case COMMAND.CREATE:
        case COMMAND.RENAME:
          await respond(RESULT.EXCEPTION_CAUGHT);
          break;
        case COMMAND.DELETE:
          // ponytail: acknowledge Goldleaf cleanup without touching user-selected files; add a File System Access handle if real deletion is required.
          addActivity("Goldleaf requested cleanup; browser file kept", "muted");
          await respond(RESULT.SUCCESS);
          break;
        case COMMAND.GET_SPECIAL_PATH_COUNT:
          await respond(RESULT.SUCCESS, (writer) => writer.writeUint32(0));
          break;
        case COMMAND.GET_SPECIAL_PATH:
          reader.readUint32();
          await respond(RESULT.INVALID_INDEX);
          break;
        case COMMAND.SELECT_FILE:
          await handleSelectFile(activeDevice);
          break;
        default:
          await respond(RESULT.EXCEPTION_CAUGHT);
      }
    } catch (error) {
      addActivity(errorMessage(error, "Protocol error"), "error");
      if (responseSent) throw error;
      if (listening.value) await respond(RESULT.EXCEPTION_CAUGHT);
    }
  }

  async function listenForCommands(activeDevice: UsbDevice) {
    try {
      while (listening.value && device.value === activeDevice) {
        if (inEndpoint.value === null) throw new ProtocolError("Goldleaf USB input endpoint is unavailable");
        const transfer = await activeDevice.transferIn(inEndpoint.value, BLOCK_SIZE);
        if (transfer.status !== "ok" || !transfer.data || transfer.data.byteLength !== BLOCK_SIZE) {
          throw new ProtocolError("USB input transfer failed");
        }
        await handleCommand(transfer.data, activeDevice);
      }
    } catch (error) {
      if (listening.value && device.value === activeDevice) {
        listening.value = false;
        connected.value = false;
        device.value = null;
        setConnectionState("idle", "Connection lost", errorMessage(error, "USB transfer stopped."));
        addActivity("Goldleaf connection stopped", "error");
        showToast("Goldleaf disconnected.");
      }
    }
  }

  function getUsb() {
    return typeof navigator === "undefined" ? null : (navigator as NavigatorWithUsb).usb || null;
  }

  async function openGoldleaf() {
    usb = getUsb();
    if (!usb) {
      setConnectionState("idle", "WebUSB unavailable", "Open this page in Chrome or Edge over localhost or HTTPS.");
      showToast("This browser does not expose WebUSB.");
      return;
    }
    if (!ensureFileSystem()) return;

    setConnectionState("pending", "Waiting for Goldleaf", "Choose the Goldleaf device in the browser dialog.");
    let openedDevice: UsbDevice | null = null;
    try {
      const selectedDevice = await usb.requestDevice({
        filters: [{ vendorId: USB_VENDOR_ID, productId: USB_PRODUCT_ID }],
      });
      openedDevice = selectedDevice;
      await selectedDevice.open();
      if (!selectedDevice.configuration) await selectedDevice.selectConfiguration(1);

      const usbInterface = selectedDevice.configuration?.interfaces.find(({ interfaceNumber: number }) => number === USB_INTERFACE)
        || selectedDevice.configuration?.interfaces[0];
      const alternate = usbInterface?.alternates[0];
      const inputEndpoint = alternate?.endpoints.find(({ direction }) => direction === "in");
      const outputEndpoint = alternate?.endpoints.find(({ direction }) => direction === "out");
      if (!usbInterface || !inputEndpoint || !outputEndpoint) throw new ProtocolError("Goldleaf USB endpoints were not found");

      await selectedDevice.claimInterface(usbInterface.interfaceNumber);
      device.value = selectedDevice;
      interfaceNumber.value = usbInterface.interfaceNumber;
      inEndpoint.value = inputEndpoint.endpointNumber;
      outEndpoint.value = outputEndpoint.endpointNumber;
      connected.value = true;
      listening.value = true;
      const version = selectedDevice.serialNumber ? `v${selectedDevice.serialNumber.replace(/-dev$/, "")} ` : "";
      setConnectionState("online", `Goldleaf ${version}`.trim(), "USB relay is listening for file requests.");
      addActivity(`Connected to Goldleaf ${version}`.trim(), "success");
      showToast("Goldleaf connected. Open Explore → Remote PC on the console.");
      void listenForCommands(selectedDevice);
    } catch (error) {
      if (openedDevice) {
        try {
          await openedDevice.close();
        } catch {
          // The device may have failed before it fully opened.
        }
      }
      if (errorName(error) === "NotFoundError") {
        setConnectionState("idle", "Waiting for Goldleaf", "No device was selected.");
        return;
      }
      setConnectionState("idle", "Could not connect", errorMessage(error, "USB setup failed."));
      addActivity("USB connection failed", "error");
      showToast("Could not connect to Goldleaf.");
    }
  }

  async function closeGoldleaf(silent = false) {
    const activeDevice = device.value;
    listening.value = false;
    connected.value = false;
    device.value = null;
    if (activeDevice) {
      try {
        await activeDevice.releaseInterface(interfaceNumber.value);
        await activeDevice.close();
      } catch {
        // The device may already be gone.
      }
    }
    if (!silent) {
      setConnectionState("idle", "Waiting for Goldleaf", "Choose an NSP, then connect the console with Goldleaf open.");
      addActivity("Goldleaf disconnected", "muted");
    }
  }

  async function toggleConnection() {
    if (connected.value) await closeGoldleaf();
    else await openGoldleaf();
  }

  onMounted(() => {
    usb = getUsb();
    if (!usb) {
      setConnectionState("idle", "WebUSB unavailable", "Open this page in Chrome or Edge over localhost or HTTPS.");
      return;
    }
    disconnectHandler = ({ device: disconnectedDevice }) => {
      if (disconnectedDevice === device.value) {
        listening.value = false;
        connected.value = false;
        device.value = null;
        setConnectionState("idle", "Goldleaf disconnected", "Reconnect the console to resume browsing.");
        addActivity("Goldleaf disconnected", "error");
      }
    };
    usb.addEventListener("disconnect", disconnectHandler);
  });

  onBeforeUnmount(() => {
    if (usb && disconnectHandler) usb.removeEventListener("disconnect", disconnectHandler);
    if (toastTimer) clearTimeout(toastTimer);
    void closeGoldleaf(true);
  });

  return {
    activities,
    addRemoteUrl,
    chooseFiles,
    clearSelection,
    commandCountLabel,
    connected,
    connection,
    directoryCount,
    entryCount,
    fileCount,
    hasSelection,
    selectionName,
    selectionType,
    toast,
    totalSize,
    toggleConnection,
    visibleFiles,
  };
}
