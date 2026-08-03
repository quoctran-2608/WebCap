import { describe, expect, it } from "vitest";

import type { PdfEditManifest } from "@shared/contracts/pdf-editor";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import {
  PdfEditManifestRepository,
  type PdfEditStorageAdapter,
} from "@storage/pdf-edit-manifest-repository";

const manifest: PdfEditManifest = {
  schemaVersion: 1,
  jobId: "job-1",
  revision: 2,
  settings: DEFAULT_CAPTURE_SETTINGS.pdf,
  pages: [
    {
      id: "page-1",
      originalIndex: 0,
      sourceRectCss: { x: 0, y: 0, width: 800, height: 1100 },
      pageWidthPt: 595.28,
      pageHeightPt: 841.89,
      imageRectPt: { x: 22.68, y: 22.68, width: 549.92, height: 756.14 },
    },
  ],
  createdAt: "2026-08-03T13:30:00.000Z",
  updatedAt: "2026-08-03T13:31:00.000Z",
  expiresAt: "2026-08-03T14:00:00.000Z",
};

function memoryStorage(): PdfEditStorageAdapter & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    get: (key) => Promise.resolve(values.has(key) ? { [key]: values.get(key) } : {}),
    set: (items) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
  };
}

describe("PdfEditManifestRepository", () => {
  it("persists and restores metadata without tile or Blob payloads", async () => {
    const storage = memoryStorage();
    const repository = new PdfEditManifestRepository(storage);

    await repository.save(manifest);
    expect(await repository.load("job-1")).toEqual(manifest);
    expect(JSON.stringify([...storage.values.values()])).not.toContain("Blob");

    await repository.delete("job-1");
    expect(await repository.load("job-1")).toBeUndefined();
  });

  it("rejects malformed stored manifests instead of guessing page state", async () => {
    const storage = memoryStorage();
    storage.values.set("webcap.pdf-edit.job-1", { ...manifest, pages: [] });
    const repository = new PdfEditManifestRepository(storage);

    await expect(repository.load("job-1")).rejects.toMatchObject({
      name: "E_STORAGE_READ",
    });
  });
});
