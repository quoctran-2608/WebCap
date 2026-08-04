import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectDirectoryEntries,
  crc32,
  createDeterministicZip,
  readStoredZip,
} from "../../scripts/release/deterministic-zip.mjs";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("deterministic release ZIP", () => {
  it("emits byte-identical archives with sorted fixed-metadata entries", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "webcap-zip-test-"));
    temporaryDirectories.push(directory);
    await mkdir(resolve(directory, "nested"), { recursive: true });
    await writeFile(resolve(directory, "z.txt"), "last", "utf8");
    await writeFile(resolve(directory, "nested/a.txt"), "first", "utf8");

    const entries = await collectDirectoryEntries(directory);
    const first = createDeterministicZip(entries);
    const second = createDeterministicZip([...entries].reverse());
    expect(second).toEqual(first);

    const decoded = readStoredZip(first);
    expect(decoded.map((entry) => entry.path)).toEqual(["nested/a.txt", "z.txt"]);
    expect(decoded.map((entry) => entry.bytes.toString("utf8"))).toEqual(["first", "last"]);
  });

  it("uses the standard CRC-32 value and rejects corrupted bytes", () => {
    expect(crc32(Buffer.from("123456789", "utf8"))).toBe(0xcbf43926);
    const archive = createDeterministicZip([{ path: "manifest.json", bytes: Buffer.from("{}") }]);
    const corrupted = Buffer.from(archive);
    const dataOffset = 30 + Buffer.byteLength("manifest.json");
    corrupted[dataOffset] ^= 0xff;
    expect(() => readStoredZip(corrupted)).toThrow(/CRC or size verification failed/u);
  });

  it("rejects duplicate and traversal paths", () => {
    expect(() =>
      createDeterministicZip([
        { path: "a.txt", bytes: Buffer.from("a") },
        { path: "a.txt", bytes: Buffer.from("b") },
      ]),
    ).toThrow(/Duplicate ZIP entry/u);
    expect(() => createDeterministicZip([{ path: "../escape", bytes: Buffer.from("x") }])).toThrow(
      /Unsafe ZIP entry path/u,
    );
  });
});
