import { describe, expect, it } from "vitest";

import { ObjectUrlRegistry, type ObjectUrlEnvironment } from "@offscreen/object-url-registry";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

function artifactRepository(record: ArtifactRecord): ArtifactRepositoryPort {
  return {
    put: () => Promise.resolve(),
    get: (artifactId) => Promise.resolve(artifactId === record.artifactId ? record : undefined),
    delete: () => Promise.resolve(false),
    deleteExpired: () => Promise.resolve(0),
  };
}

function environment(created: Blob[], revoked: string[]): ObjectUrlEnvironment {
  return {
    create(blob) {
      created.push(blob);
      return `blob:webcap/${created.length}`;
    },
    revoke(url) {
      revoked.push(url);
    },
    setTimer: () => 1,
    clearTimer: () => undefined,
  };
}

describe("ObjectUrlRegistry S32 disk-backed artifacts", () => {
  it("reads an OPFS-backed output only when an object URL is requested", async () => {
    const diskBlob = new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
    const record: ArtifactRecord = {
      artifactId: "pdf-opfs",
      sourceArtifactId: "job-1",
      jobId: "job-1",
      role: "output",
      format: "pdf",
      mimeType: "application/pdf",
      filename: "capture.pdf",
      byteLength: diskBlob.size,
      width: 595,
      height: 842,
      pageCount: 1,
      createdAt: "2026-08-08T04:00:00.000Z",
      expiresAt: "2026-08-08T04:30:00.000Z",
      opfsReference: "webcap-pdf-output/pdf-opfs.pdf",
    };
    const created: Blob[] = [];
    const revoked: string[] = [];
    const reads: string[] = [];
    const registry = new ObjectUrlRegistry({
      artifacts: artifactRepository(record),
      diskArtifacts: {
        read(reference) {
          reads.push(reference);
          return Promise.resolve(diskBlob);
        },
      },
      environment: environment(created, revoked),
    });

    expect(reads).toEqual([]);
    const url = await registry.create("pdf-opfs");
    expect(url).toBe("blob:webcap/1");
    expect(reads).toEqual(["webcap-pdf-output/pdf-opfs.pdf"]);
    expect(created).toEqual([diskBlob]);
    expect(registry.revoke(url)).toBe(true);
    expect(revoked).toEqual([url]);
  });

  it("keeps legacy Blob-backed artifacts independent of the disk reader", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const record: ArtifactRecord = {
      artifactId: "image-blob",
      sourceArtifactId: "source-1",
      jobId: "job-1",
      role: "output",
      format: "png",
      mimeType: "image/png",
      filename: "capture.png",
      byteLength: blob.size,
      width: 1,
      height: 1,
      createdAt: "2026-08-08T04:00:00.000Z",
      expiresAt: "2026-08-08T04:30:00.000Z",
      blob,
    };
    const created: Blob[] = [];
    const registry = new ObjectUrlRegistry({
      artifacts: artifactRepository(record),
      diskArtifacts: {
        read: () => Promise.reject(new Error("disk reader must not run")),
      },
      environment: environment(created, []),
    });

    await expect(registry.create("image-blob")).resolves.toBe("blob:webcap/1");
    expect(created).toEqual([blob]);
  });
});
