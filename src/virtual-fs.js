export const REMOTE_ROOT = "web";

export function normalizeRelativePath(input = "") {
  const segments = String(input)
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");

  return segments.join("/");
}

export function toRemotePath(relativePath = "") {
  const normalized = normalizeRelativePath(relativePath);
  return normalized ? `${REMOTE_ROOT}:/${normalized}` : `${REMOTE_ROOT}:/`;
}

export function parseRemotePath(remotePath) {
  const normalized = String(remotePath).replaceAll("\\", "/");
  const colonIndex = normalized.indexOf(":");
  const root = colonIndex === -1 ? REMOTE_ROOT : normalized.slice(0, colonIndex);

  if (root !== REMOTE_ROOT) {
    return null;
  }

  const relativePath = colonIndex === -1 ? normalized : normalized.slice(colonIndex + 1);
  return normalizeRelativePath(relativePath);
}

export function createVirtualFileSystem(files = []) {
  const fileMap = new Map();
  const directorySet = new Set([""]);

  for (const file of files) {
    const relativePath = normalizeRelativePath(file.relativePath || file.webkitRelativePath || file.name);
    if (!relativePath || fileMap.has(relativePath)) {
      continue;
    }

    fileMap.set(relativePath, file);
    const parts = relativePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directorySet.add(parts.slice(0, index).join("/"));
    }
  }

  const children = (relativePath, directories) => {
    const parent = normalizeRelativePath(relativePath);
    const prefix = parent ? `${parent}/` : "";
    const names = new Set();

    for (const candidate of directories ? directorySet : fileMap.keys()) {
      if (!candidate.startsWith(prefix)) {
        continue;
      }

      const rest = candidate.slice(prefix.length);
      if (rest && !rest.includes("/")) {
        names.add(rest);
      }
    }

    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  };

  return {
    files: fileMap,
    filePaths: [...fileMap.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    directoryPaths: [...directorySet].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    getFile(relativePath) {
      return fileMap.get(normalizeRelativePath(relativePath));
    },
    isFile(relativePath) {
      return fileMap.has(normalizeRelativePath(relativePath));
    },
    isDirectory(relativePath) {
      return directorySet.has(normalizeRelativePath(relativePath));
    },
    listFiles(relativePath) {
      const parent = normalizeRelativePath(relativePath);
      if (!directorySet.has(parent)) {
        return [];
      }
      return children(parent, false);
    },
    listDirectories(relativePath) {
      const parent = normalizeRelativePath(relativePath);
      if (!directorySet.has(parent)) {
        return [];
      }
      return children(parent, true);
    },
    totalBytes() {
      return [...fileMap.values()].reduce((total, file) => total + Number(file.size || 0), 0);
    },
  };
}
