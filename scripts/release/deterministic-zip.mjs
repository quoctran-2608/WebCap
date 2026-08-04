import { Buffer } from "node:buffer";
import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const DOS_DATE_1980_01_01 = 0x0021;
const DOS_TIME_MIDNIGHT = 0;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY_UNIX = 0x0314;
const REGULAR_FILE_MODE = (0o100644 << 16) >>> 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const tableValue = CRC_TABLE[(crc ^ byte) & 0xff];
    if (tableValue === undefined) {
      throw new Error("CRC table lookup failed.");
    }
    crc = tableValue ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function normalizeArchivePath(path) {
  const normalized = path.split(sep).join("/").replace(/^\.\//u, "");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe ZIP entry path: ${path}`);
  }
  return normalized;
}

export async function collectDirectoryEntries(rootDirectory, options = {}) {
  const root = resolve(rootDirectory);
  const shouldInclude = options.shouldInclude ?? (() => true);
  const entries = [];

  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const child of children) {
      const absolutePath = resolve(directory, child.name);
      if (child.isSymbolicLink()) {
        throw new Error(`Release package cannot include symbolic links: ${absolutePath}`);
      }
      if (child.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!child.isFile()) {
        throw new Error(
          `Release package contains an unsupported filesystem entry: ${absolutePath}`,
        );
      }

      const archivePath = normalizeArchivePath(relative(root, absolutePath));
      if (!shouldInclude(archivePath)) continue;
      const metadata = await stat(absolutePath);
      if (metadata.size > 0xffffffff) {
        throw new Error(`ZIP64 is not supported for ${archivePath}.`);
      }
      entries.push({
        path: archivePath,
        bytes: await readFile(absolutePath),
      });
    }
  }

  await visit(root);
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return entries;
}

export function createDeterministicZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("A release ZIP must contain at least one file.");
  }
  if (entries.length > 0xffff) {
    throw new Error("ZIP64 is not supported for more than 65,535 files.");
  }

  const seenPaths = new Set();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  const normalizedEntries = entries
    .map((entry) => ({
      path: normalizeArchivePath(entry.path),
      bytes: Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes),
    }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));

  for (const entry of normalizedEntries) {
    if (seenPaths.has(entry.path)) {
      throw new Error(`Duplicate ZIP entry: ${entry.path}`);
    }
    seenPaths.add(entry.path);

    if (entry.bytes.length > 0xffffffff) {
      throw new Error(`ZIP64 is not supported for ${entry.path}.`);
    }
    const name = Buffer.from(entry.path, "utf8");
    if (name.length > 0xffff) {
      throw new Error(`ZIP entry name is too long: ${entry.path}`);
    }

    const checksum = crc32(entry.bytes);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(VERSION_NEEDED, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(STORE_METHOD, 8);
    localHeader.writeUInt16LE(DOS_TIME_MIDNIGHT, 10);
    localHeader.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(entry.bytes.length, 18);
    localHeader.writeUInt32LE(entry.bytes.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, entry.bytes);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
    centralHeader.writeUInt16LE(VERSION_MADE_BY_UNIX, 4);
    centralHeader.writeUInt16LE(VERSION_NEEDED, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(STORE_METHOD, 10);
    centralHeader.writeUInt16LE(DOS_TIME_MIDNIGHT, 12);
    centralHeader.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.bytes.length, 20);
    centralHeader.writeUInt32LE(entry.bytes.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(REGULAR_FILE_MODE, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + entry.bytes.length;
    if (localOffset > 0xffffffff) {
      throw new Error("ZIP64 is not supported for archives larger than 4 GiB.");
    }
  }

  const centralDirectory = Buffer.concat(centralParts);
  if (centralDirectory.length > 0xffffffff) {
    throw new Error("ZIP64 is not supported for this central directory.");
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalizedEntries.length, 8);
  end.writeUInt16LE(normalizedEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function findEndOfCentralDirectory(zipBytes) {
  const minimumOffset = Math.max(0, zipBytes.length - 65_557);
  for (let offset = zipBytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (zipBytes.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new Error("ZIP end-of-central-directory record was not found.");
}

export function readStoredZip(zipInput) {
  const zipBytes = Buffer.isBuffer(zipInput) ? zipInput : Buffer.from(zipInput);
  const endOffset = findEndOfCentralDirectory(zipBytes);
  const diskNumber = zipBytes.readUInt16LE(endOffset + 4);
  const centralDisk = zipBytes.readUInt16LE(endOffset + 6);
  const diskEntryCount = zipBytes.readUInt16LE(endOffset + 8);
  const totalEntryCount = zipBytes.readUInt16LE(endOffset + 10);
  const centralSize = zipBytes.readUInt32LE(endOffset + 12);
  const centralOffset = zipBytes.readUInt32LE(endOffset + 16);
  const commentLength = zipBytes.readUInt16LE(endOffset + 20);

  if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== totalEntryCount) {
    throw new Error("Multi-disk ZIP archives are not supported.");
  }
  if (commentLength !== 0 || endOffset + 22 !== zipBytes.length) {
    throw new Error("Release ZIP must not contain an archive comment or trailing bytes.");
  }
  if (centralOffset + centralSize !== endOffset) {
    throw new Error("ZIP central directory bounds are invalid.");
  }

  const entries = [];
  const seenPaths = new Set();
  let cursor = centralOffset;
  for (let index = 0; index < totalEntryCount; index += 1) {
    if (zipBytes.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error(`Invalid central directory signature at entry ${index}.`);
    }
    const flags = zipBytes.readUInt16LE(cursor + 8);
    const method = zipBytes.readUInt16LE(cursor + 10);
    const modifiedTime = zipBytes.readUInt16LE(cursor + 12);
    const modifiedDate = zipBytes.readUInt16LE(cursor + 14);
    const expectedChecksum = zipBytes.readUInt32LE(cursor + 16);
    const compressedSize = zipBytes.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBytes.readUInt32LE(cursor + 24);
    const nameLength = zipBytes.readUInt16LE(cursor + 28);
    const extraLength = zipBytes.readUInt16LE(cursor + 30);
    const fileCommentLength = zipBytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBytes.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    const path = normalizeArchivePath(zipBytes.subarray(nameStart, nameEnd).toString("utf8"));

    if ((flags & UTF8_FLAG) === 0 || method !== STORE_METHOD) {
      throw new Error(`Release ZIP entry must be UTF-8 and stored without compression: ${path}`);
    }
    if (modifiedTime !== DOS_TIME_MIDNIGHT || modifiedDate !== DOS_DATE_1980_01_01) {
      throw new Error(`Release ZIP entry has a non-deterministic timestamp: ${path}`);
    }
    if (extraLength !== 0 || fileCommentLength !== 0) {
      throw new Error(`Release ZIP entry contains unsupported metadata: ${path}`);
    }
    if (compressedSize !== uncompressedSize) {
      throw new Error(`Stored ZIP entry size mismatch: ${path}`);
    }
    if (seenPaths.has(path)) {
      throw new Error(`Duplicate ZIP entry: ${path}`);
    }
    seenPaths.add(path);

    if (zipBytes.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
      throw new Error(`Invalid local header for ${path}.`);
    }
    const localNameLength = zipBytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zipBytes.readUInt16LE(localHeaderOffset + 28);
    const localNameStart = localHeaderOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const localName = zipBytes.subarray(localNameStart, localNameEnd).toString("utf8");
    if (localName !== path || localExtraLength !== 0) {
      throw new Error(`Local header metadata mismatch for ${path}.`);
    }
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    const bytes = zipBytes.subarray(dataStart, dataEnd);
    if (bytes.length !== uncompressedSize || crc32(bytes) !== expectedChecksum) {
      throw new Error(`CRC or size verification failed for ${path}.`);
    }

    entries.push({ path, bytes: Buffer.from(bytes), crc32: expectedChecksum });
    cursor = nameEnd + extraLength + fileCommentLength;
  }

  if (cursor !== endOffset) {
    throw new Error("ZIP central directory contains unexpected trailing data.");
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return entries;
}
