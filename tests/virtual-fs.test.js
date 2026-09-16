import assert from "node:assert/strict";
import test from "node:test";
import { createVirtualFileSystem, parseRemotePath, toRemotePath } from "../src/virtual-fs.js";
import { BlockReader, BlockWriter, INPUT_MAGIC } from "../src/protocol.js";
import { createRemoteSource, parseContentRange } from "../src/remote-source.js";

test("builds a browsable virtual tree from folder files", () => {
  const fileSystem = createVirtualFileSystem([
    { name: "game.nsp", relativePath: "Drop/game.nsp", size: 42 },
    { name: "readme.txt", relativePath: "Drop/docs/readme.txt", size: 8 },
  ]);

  assert.deepEqual(fileSystem.listDirectories(""), ["Drop"]);
  assert.deepEqual(fileSystem.listFiles("Drop"), ["game.nsp"]);
  assert.deepEqual(fileSystem.listFiles("Drop/docs"), ["readme.txt"]);
  assert.equal(fileSystem.totalBytes(), 50);
  assert.equal(parseRemotePath(toRemotePath("Drop/game.nsp")), "Drop/game.nsp");
  assert.equal(parseRemotePath("other:/Drop/game.nsp"), null);
});

test("command values round-trip as little-endian Goldleaf data", () => {
  const writer = new BlockWriter();
  writer.writeUint32(INPUT_MAGIC);
  writer.writeUint64(0x1020304050607080n);
  writer.writeString("web:/Drop");

  const reader = new BlockReader(writer.toBytes());
  assert.equal(reader.readUint32(), INPUT_MAGIC);
  assert.equal(reader.readUint64(), 0x1020304050607080n);
  assert.equal(reader.readString(), "web:/Drop");
});

test("remote sources probe and read HTTP byte ranges", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    requests.push({ url, options, headers });
    if (options.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-length": "4" } });
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") || "");
    assert.ok(match);
    const start = Number(match[1]);
    const end = Number(match[2]);
    const body = Uint8Array.from({ length: end - start + 1 }, (_, index) => start + index);
    return new Response(body, {
      status: 206,
      headers: { "content-range": `bytes ${start}-${end}/4` },
    });
  };

  try {
    assert.deepEqual(parseContentRange("bytes 0-0/4"), { start: 0, end: 0, size: 4 });
    const source = await createRemoteSource("https://example.test/game.nsp");
    assert.equal(source.name, "game.nsp");
    assert.equal(source.size, 4);
    assert.deepEqual([...await source.read(1, 2)], [1, 2]);
    assert.equal(requests[1].headers.get("range"), "bytes=0-0");
    assert.equal(requests[2].headers.get("range"), "bytes=1-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
