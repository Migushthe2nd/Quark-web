<script setup lang="ts">
import { ref } from "vue";
import { useQuarkBridge } from "~/composables/useQuarkBridge";

const fileInput = ref<HTMLInputElement | null>(null);
const requestFileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const remoteUrl = ref("");
const remoteName = ref("");
const addingRemote = ref(false);
const isDragging = ref(false);
const filePickerRequested = ref(false);

let pendingFilePicker: ((file: File | null) => void) | null = null;

function openFilePicker(input: HTMLInputElement | null = fileInput.value) {
  if (!input) return;
  input.value = "";
  input.click();
}

function requestFileFromPc() {
  return new Promise<File | null>((resolve) => {
    pendingFilePicker?.(null);
    pendingFilePicker = resolve;
    filePickerRequested.value = true;
    openFilePicker(requestFileInput.value);
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
  chooseFiles((event.target as HTMLInputElement).files, kind);
}

function handleRequestedFileChange(event: Event) {
  const resolve = pendingFilePicker;
  pendingFilePicker = null;
  filePickerRequested.value = false;
  resolve?.((event.target as HTMLInputElement).files?.[0] || null);
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
  if (requestFileInput.value) requestFileInput.value.value = "";
  if (folderInput.value) folderInput.value.value = "";
  remoteUrl.value = "";
  remoteName.value = "";
}
</script>

<template>
  <main class="page">
    <section class="connection-strip" :data-state="connection.mode" aria-labelledby="connection-title">
      <div class="connection-copy">
        <div class="connection-title-row">
          <div class="app-title">
            <h1 id="connection-title">Quark Web Bridge for Goldleaf</h1>
            <a
              class="repo-link focus-ring"
              href="https://github.com/Migushthe2nd/Quark-web"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Quark Web Bridge for Goldleaf on GitHub"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.16-.02-2.1-3.2.69-3.88-1.54-3.88-1.54-.53-1.34-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.25 3.33.96.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18A10.98 10.98 0 0 1 12 6.32c.97 0 1.94.13 2.85.38 2.18-1.49 3.14-1.18 3.14-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.08.78 2.18 0 1.57-.01 2.84-.01 3.22 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
              </svg>
            </a>
          </div>
        </div>
        <p class="connection-device">{{ connection.deviceTitle }}</p>
        <p class="connection-detail">{{ connection.deviceDetail }}</p>
      </div>
      <div class="connection-actions">
        <span class="connection-state" :data-state="connection.mode">
          <span class="state-dot" aria-hidden="true"></span>
          {{ connection.label }}
        </span>
        <button
          class="primary-button focus-ring"
          type="button"
          :disabled="connection.mode === 'pending'"
          :aria-busy="connection.mode === 'pending'"
          @click="toggleConnection"
        >
          <span v-if="connection.mode === 'pending'" class="button-spinner" aria-hidden="true"></span>
          {{ connection.buttonLabel }}
        </button>
      </div>
    </section>

    <section class="workspace" aria-labelledby="workspace-title">
      <div class="workspace-bar">
        <div class="location">
          <div>
            <h2 id="workspace-title">web:/</h2>
            <span>Browser drive</span>
          </div>
        </div>
        <span class="workspace-state" :data-state="hasSelection ? 'mounted' : 'empty'">
          <span class="state-dot" aria-hidden="true"></span>
          {{ hasSelection ? "Mounted" : "Empty" }}
        </span>
      </div>

      <div v-if="filePickerRequested" class="file-picker-request" role="status" aria-live="polite">
        <div>
          <span class="request-kicker">Goldleaf requested a file</span>
          <strong>Select an NSP from this PC</strong>
        </div>
        <div class="request-actions">
          <button class="secondary-button emphasis focus-ring" type="button" @click="openFilePicker(requestFileInput)">Select file</button>
          <button class="text-button focus-ring" type="button" @click="cancelPendingFilePicker">Cancel</button>
        </div>
      </div>

      <div v-if="hasSelection" class="selection" aria-live="polite">
        <div class="source-summary">
          <div class="source-copy">
            <span class="label">Mounted source</span>
            <strong :title="selectionName">{{ selectionName }}</strong>
            <span class="source-meta">{{ selectionType }} · {{ totalSize }}</span>
          </div>
          <button class="text-button focus-ring" type="button" @click="clearWorkspace">Clear</button>
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

      <input ref="fileInput" type="file" accept=".nsp" multiple hidden @change="handleFileChange($event, 'file')" />
      <input ref="requestFileInput" type="file" accept=".nsp" hidden @cancel="cancelPendingFilePicker" @change="handleRequestedFileChange" />
      <input ref="folderInput" type="file" webkitdirectory directory multiple hidden @change="handleFileChange($event, 'folder')" />

      <div
        class="drop-zone"
        :class="{ dragging: isDragging }"
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop.prevent="handleDrop"
      >
        <div class="drop-actions">
          <button class="secondary-button emphasis focus-ring" type="button" @click="chooseFile">Choose NSP(s)</button>
          <button class="secondary-button focus-ring" type="button" @click="chooseFolder">Choose folder</button>
        </div>
        <small class="drop-hint">or drop NSP file(s) here</small>
      </div>

      <details class="advanced">
        <summary>Advanced: Direct NSP URL</summary>
        <form class="url-form" @submit.prevent="handleRemoteSubmit">
          <div class="url-field">
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
          </div>
          <div class="url-field">
            <label for="remote-name">Filename <span>(optional)</span></label>
            <input
              id="remote-name"
              v-model="remoteName"
              type="text"
              autocomplete="off"
              placeholder="game.nsp"
            />
          </div>
          <button class="secondary-button focus-ring" type="submit" :disabled="addingRemote">
            {{ addingRemote ? "Checking URL…" : "Link NSP" }}
          </button>
        </form>
        <p class="advanced-help">The host must allow CORS and HTTP byte-range requests.</p>
      </details>

      <p class="capability-note"><span aria-hidden="true">i</span> Read-only bridge. Goldleaf can browse and read the mounted source; it cannot write to this computer.</p>
    </section>

    <section class="activity" aria-labelledby="activity-title">
      <div class="activity-heading">
        <div>
          <h2 id="activity-title">USB Activity</h2>
        </div>
        <span class="activity-count">{{ commandCountLabel }}</span>
      </div>
      <ol>
        <li v-for="activity in activities" :key="activity.id" :class="activity.kind">
          <span class="activity-dot" aria-hidden="true"></span>
          <span>{{ activity.message }}</span>
        </li>
      </ol>
      <div class="activity-footer">
        <span class="state-dot" :data-state="connection.mode" aria-hidden="true"></span>
        {{ connection.workspaceStatus }}
      </div>
    </section>
  </main>

  <div class="toast" :class="{ visible: toast }" role="status" aria-live="polite">{{ toast }}</div>
</template>
