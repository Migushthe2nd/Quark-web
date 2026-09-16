import { ProtocolError } from "./protocol.js";

function parseContentLength(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 ? size : null;
}

export function parseContentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(String(value || "").trim());
  if (!match) return null;

  const [start, end, size] = match.slice(1).map(Number);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(size) || end < start || size <= end) {
    return null;
  }
  return { start, end, size };
}

function remoteFilename(url, requestedName) {
  let fallback = "remote.nsp";
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").filter(Boolean).pop();
    if (lastSegment) fallback = decodeURIComponent(lastSegment);
  } catch {
    // The URL was already validated by createRemoteSource.
  }

  const suppliedName = requestedName.trim();
  const filename = (suppliedName || fallback).replaceAll("\\", "/").split("/").pop()?.trim() || "remote.nsp";
  if (suppliedName && !filename.toLowerCase().endsWith(".nsp")) {
    throw new ProtocolError("Remote filename must end in .nsp");
  }
  return filename.toLowerCase().endsWith(".nsp") ? filename : "remote.nsp";
}

async function fetchRemote(url, options) {
  try {
    return await fetch(url, {
      ...options,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new ProtocolError("The remote NSP could not be fetched. Check the URL and its CORS policy.");
  }
}

async function discard(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The probe body is only one byte; closing it is best effort.
  }
}

export async function createRemoteSource(inputUrl, requestedName = "") {
  let url;
  try {
    url = new URL(inputUrl.trim());
  } catch {
    throw new ProtocolError("Enter a valid NSP URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProtocolError("Remote NSP URLs must use HTTP or HTTPS");
  }

  let resolvedUrl = url.toString();
  let headSize = null;
  try {
    const head = await fetchRemote(resolvedUrl, { method: "HEAD" });
    if (head.ok) {
      resolvedUrl = head.url || resolvedUrl;
      headSize = parseContentLength(head.headers.get("content-length"));
    }
    await discard(head);
  } catch {
    // The byte-range probe below provides the useful error if HEAD is blocked.
  }

  const probe = await fetchRemote(resolvedUrl, { headers: { Range: "bytes=0-0" } });
  if (probe.status !== 206) {
    await discard(probe);
    throw new ProtocolError("The remote server must support HTTP byte-range requests");
  }

  const contentRange = parseContentRange(probe.headers.get("content-range"));
  const size = contentRange?.size || headSize;
  if (!size || (contentRange && (contentRange.start !== 0 || contentRange.end !== 0))) {
    await discard(probe);
    throw new ProtocolError("The remote server did not expose the NSP size");
  }
  await discard(probe);

  const name = remoteFilename(url.toString(), requestedName);
  return {
    name,
    size,
    relativePath: name,
    url: resolvedUrl,
    async read(offset, length) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) {
        throw new ProtocolError("Remote NSP read is outside the file range");
      }
      if (!length) return new Uint8Array();

      const end = offset + length - 1;
      const response = await fetchRemote(resolvedUrl, { headers: { Range: `bytes=${offset}-${end}` } });
      if (response.status !== 206) {
        await discard(response);
        throw new ProtocolError("The remote server stopped supporting byte ranges");
      }

      const returnedRange = parseContentRange(response.headers.get("content-range"));
      if (returnedRange && (returnedRange.start !== offset || returnedRange.end !== end)) {
        await discard(response);
        throw new ProtocolError("The remote server returned the wrong byte range");
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== length) {
        throw new ProtocolError("The remote server returned an incomplete byte range");
      }
      return bytes;
    },
  };
}
