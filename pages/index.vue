<script setup lang="ts">
import { ref } from "vue";
import { useQuarkBridge } from "~/composables/useQuarkBridge";

const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const remoteUrl = ref("");
const remoteName = ref("");
const addingRemote = ref(false);
const isDragging = ref(false);
const filePickerRequested = ref(false);

let pendingFilePicker: ((file: File | null) => void) | null = null;

function openFilePicker() {
  if (!fileInput.value) return;
  fileInput.value.value = "";
  fileInput.value.click();
}

function requestFileFromPc() {
  return new Promise<File | null>((resolve) => {
    pendingFilePicker?.(null);
    pendingFilePicker = resolve;
    filePickerRequested.value = true;
    openFilePicker();
  });
}

const {
  addRemoteUrl,
  activities,
  chooseFiles,
  clearSelection,
  commandCountLabel,
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
} = useQuarkBridge(requestFileFromPc);

function chooseFile() {
  openFilePicker();
}

function chooseFolder() {
  folderInput.value?.click();
}

function handleFileChange(event: Event, kind: "file" | "folder") {
  const files = (event.target as HTMLInputElement).files;
  if (kind === "file" && pendingFilePicker) {
    const resolve = pendingFilePicker;
    pendingFilePicker = null;
    filePickerRequested.value = false;
    resolve(files?.[0] || null);
    return;
  }
  chooseFiles(files, kind);
}

function cancelPendingFilePicker() {
  if (!pendingFilePicker) return;
  const resolve = pendingFilePicker;
  pendingFilePicker = null;
  filePickerRequested.value = false;
  resolve(null);
}

function handleDrop(event: DragEvent) {
  isDragging.value = false;
  chooseFiles(event.dataTransfer?.files || null, "file");
}

function handleDropZoneKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    chooseFile();
  }
}

async function handleRemoteSubmit() {
  addingRemote.value = true;
  try {
    await addRemoteUrl(remoteUrl.value, remoteName.value);
    remoteUrl.value = "";
    remoteName.value = "";
  } finally {
    addingRemote.value = false;
  }
}

function clearWorkspace() {
  cancelPendingFilePicker();
  clearSelection();
  if (fileInput.value) fileInput.value.value = "";
  if (folderInput.value) folderInput.value.value = "";
  remoteUrl.value = "";
  remoteName.value = "";
}
</script>

<template>
  <main class="page">
    <section class="panel" aria-labelledby="workspace-title">
      <div class="panel-heading">
        <div>
          <h2 id="workspace-title">Quark web bridge for Goldleaf</h2>
        </div>
        <span class="workspace-path">web:/</span>
      </div>
      <p class="helper">Choose an NSP file or folder now, or connect and choose one from Goldleaf.</p>

      <div class="actions">
        <button class="secondary-button focus-ring" type="button" @click="chooseFile">Choose NSP file</button>
        <button class="secondary-button focus-ring" type="button" @click="chooseFolder">Choose folder</button>
        <button v-if="hasSelection" class="text-button focus-ring" type="button" @click="clearWorkspace">Clear</button>
        <input ref="fileInput" type="file" accept=".nsp" hidden @cancel="cancelPendingFilePicker" @change="handleFileChange($event, 'file')" />
        <input ref="folderInput" type="file" webkitdirectory directory multiple hidden @change="handleFileChange($event, 'folder')" />
      </div>

      <div v-if="filePickerRequested" class="file-picker-request" role="status" aria-live="polite">
        <span>Goldleaf is requesting an NSP file.</span>
        <div class="request-actions">
          <button class="secondary-button focus-ring" type="button" @click="openFilePicker">Select file from PC</button>
          <button class="text-button focus-ring" type="button" @click="cancelPendingFilePicker">Cancel</button>
        </div>
      </div>

      <div
        class="drop-zone"
        :class="{ dragging: isDragging }"
        role="button"
        tabindex="0"
        aria-label="Drop an NSP file here or choose a file"
        @click="chooseFile"
        @keydown="handleDropZoneKeydown"
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop.prevent="handleDrop"
      >
        <strong>Drop an NSP file here</strong>
        <span>or use one of the buttons above</span>
      </div>

      <details class="advanced">
        <summary>Advanced: add an NSP URL</summary>
        <form class="url-form" @submit.prevent="handleRemoteSubmit">
          <label for="remote-url">Direct URL</label>
          <input
            id="remote-url"
            v-model="remoteUrl"
            type="url"
            inputmode="url"
            autocomplete="off"
            placeholder="https://example.com/game.nsp"
            required
          />
          <label for="remote-name">Filename (optional)</label>
          <input
            id="remote-name"
            v-model="remoteName"
            type="text"
            autocomplete="off"
            placeholder="game.nsp"
          />
          <button class="secondary-button focus-ring" type="submit" :disabled="addingRemote">
            {{ addingRemote ? "Checking URL…" : "Use URL" }}
          </button>
        </form>
        <p class="advanced-help">The server must allow CORS and HTTP byte-range requests.</p>
      </details>

      <div v-if="!hasSelection" class="empty-state">
        No NSP selected yet.
      </div>

      <div v-else class="selection" aria-live="polite">
        <div class="selection-heading">
          <div>
            <span class="label">Mounted source</span>
            <strong>{{ selectionName }}</strong>
          </div>
          <span class="source-badge">{{ selectionType }}</span>
        </div>

        <div class="stats" aria-label="Workspace summary">
          <div><strong>{{ fileCount }}</strong><span>files</span></div>
          <div><strong>{{ directoryCount }}</strong><span>folders</span></div>
          <div><strong>{{ totalSize }}</strong><span>size</span></div>
        </div>

        <ul v-if="selectionType === 'Folder' || fileCount > 1" class="file-list">
          <li v-for="file in visibleFiles" :key="file.path">
            <span class="file-icon" aria-hidden="true">N</span>
            <span class="file-name" :title="file.path">{{ file.path }}</span>
            <span class="file-size">{{ file.size }}</span>
          </li>
          <li v-if="entryCount > visibleFiles.length" class="more-files">
            + {{ entryCount - visibleFiles.length }} more entr{{ entryCount - visibleFiles.length === 1 ? 'y' : 'ies' }}
          </li>
        </ul>
      </div>
    </section>

    <section class="panel connection-panel" aria-labelledby="connection-title">
      <div>
        <div class="connection-heading">
          <div>
            <span class="kicker">USB connection</span>
            <h2 id="connection-title">{{ connection.deviceTitle }}</h2>
          </div>
          <span class="connection-state" :data-state="connection.mode">
            <span class="state-dot" aria-hidden="true"></span>
            {{ connection.label }}
          </span>
        </div>
        <p class="helper">{{ connection.deviceDetail }}</p>
      </div>
      <NButton
        type="button"
        class="primary-button focus-ring"
        :disabled="connection.mode === 'pending'"
        :loading="connection.mode === 'pending'"
        @click="toggleConnection"
      >
        {{ connection.buttonLabel }}
      </NButton>
    </section>

    <section class="activity" aria-labelledby="activity-title">
      <div class="activity-heading">
        <h2 id="activity-title">Activity</h2>
        <span>{{ commandCountLabel }}</span>
      </div>
      <ol>
        <li v-for="activity in activities" :key="activity.id" :class="activity.kind">
          <span class="activity-dot" aria-hidden="true"></span>
          {{ activity.message }}
        </li>
      </ol>
    </section>

    <p class="note">Goldleaf must be running on the console. This page sends selected NSPs to Goldleaf; it does not write files back to your computer.</p>
  </main>

  <div class="toast" :class="{ visible: toast }" role="status" aria-live="polite">{{ toast }}</div>
</template>
