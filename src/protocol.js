export const BLOCK_SIZE = 0x1000;
export const INPUT_MAGIC = 0x49434c47;
export const OUTPUT_MAGIC = 0x4f434c47;

export const RESULT = Object.freeze({
  SUCCESS: 0,
  EXCEPTION_CAUGHT: 0xbaf1,
  INVALID_INDEX: 0xbaf2,
  INVALID_FILE_MODE: 0xbaf3,
  SELECTION_CANCELLED: 0xbaf4,
});

export const COMMAND = Object.freeze({
  GET_DRIVE_COUNT: 1,
  GET_DRIVE_INFO: 2,
  STAT_PATH: 3,
  GET_FILE_COUNT: 4,
  GET_FILE: 5,
  GET_DIRECTORY_COUNT: 6,
  GET_DIRECTORY: 7,
  START_FILE: 8,
  READ_FILE: 9,
  WRITE_FILE: 10,
  END_FILE: 11,
  CREATE: 12,
  DELETE: 13,
  RENAME: 14,
  GET_SPECIAL_PATH_COUNT: 15,
  GET_SPECIAL_PATH: 16,
  SELECT_FILE: 17,
});

export const COMMAND_LABELS = Object.freeze({
  1: "GetDriveCount",
  2: "GetDriveInfo",
  3: "StatPath",
  4: "GetFileCount",
  5: "GetFile",
  6: "GetDirectoryCount",
  7: "GetDirectory",
  8: "StartFile",
  9: "ReadFile",
  10: "WriteFile",
  11: "EndFile",
  12: "Create",
  13: "Delete",
  14: "Rename",
  15: "GetSpecialPathCount",
  16: "GetSpecialPath",
  17: "SelectFile",
});

export class ProtocolError extends Error {}

export class BlockReader {
  constructor(data) {
    if (data instanceof DataView) {
      this.view = data;
    } else if (data instanceof ArrayBuffer) {
      this.view = new DataView(data);
    } else {
      this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }
    this.offset = 0;
  }

  ensure(length) {
    if (this.offset + length > this.view.byteLength) {
      throw new ProtocolError("Command block ended unexpectedly");
    }
  }

  readUint32() {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUint64() {
    this.ensure(8);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readString() {
    const length = this.readUint32();
    this.ensure(length);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    const value = new TextDecoder().decode(bytes);
    this.offset += length;
    return value;
  }
}

export class BlockWriter {
  constructor() {
    this.buffer = new ArrayBuffer(BLOCK_SIZE);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  ensure(length) {
    if (this.offset + length > BLOCK_SIZE) {
      throw new ProtocolError("Response does not fit in a command block");
    }
  }

  writeUint32(value) {
    this.ensure(4);
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  writeUint64(value) {
    this.ensure(8);
    this.view.setBigUint64(this.offset, BigInt(value), true);
    this.offset += 8;
  }

  writeString(value) {
    const bytes = new TextEncoder().encode(value);
    this.writeUint32(bytes.byteLength);
    this.ensure(bytes.byteLength);
    new Uint8Array(this.buffer, this.offset, bytes.byteLength).set(bytes);
    this.offset += bytes.byteLength;
  }

  toBytes() {
    return new Uint8Array(this.buffer);
  }
}

export function responseBlock(result, write = () => {}) {
  const writer = new BlockWriter();
  writer.writeUint32(OUTPUT_MAGIC);
  writer.writeUint32(result);
  write(writer);
  return writer.toBytes();
}
