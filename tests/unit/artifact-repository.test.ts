import { describe, expect, it } from "vitest";

import { IndexedDbArtifactRepository } from "@storage/artifact-repository";

const record = {
  artifactId: "artifact-1",
  sourceArtifactId: "artifact-1",
  jobId: "artifact-1",
  role: "source" as const,
  format: "png" as const,
  mimeType: "image/png" as const,
  filename: "source.png",
  byteLength: 1,
  width: 1,
  height: 1,
  createdAt: "2026-08-02T11:00:00.000Z",
  expiresAt: "2026-08-02T11:30:00.000Z",
  blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
};

function createImmediateReadDatabase(value: unknown): IDBDatabase {
  const transaction = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore: () => ({
      get: () => {
        const request = {
          result: value,
          error: null,
          onsuccess: null,
          onerror: null,
        } as unknown as IDBRequest;
        queueMicrotask(() => {
          request.onsuccess?.call(request, new Event("success"));
          transaction.oncomplete?.call(transaction, new Event("complete"));
        });
        return request;
      },
    }),
  } as unknown as IDBTransaction;
  return {
    transaction: () => transaction,
  } as unknown as IDBDatabase;
}

describe("IndexedDbArtifactRepository", () => {
  it("subscribes to transaction completion before a fast read request can finish", async () => {
    const repository = new IndexedDbArtifactRepository({
      openDatabase: () => Promise.resolve(createImmediateReadDatabase(record)),
    });

    await expect(repository.get(record.artifactId)).resolves.toEqual(record);
  }, 1_000);

  it("normalizes quota failures with a user-safe code", async () => {
    const repository = new IndexedDbArtifactRepository({
      openDatabase: () => Promise.reject(new DOMException("quota", "QuotaExceededError")),
    });

    await expect(repository.put(record)).rejects.toMatchObject({
      code: "E_STORAGE_QUOTA",
      stage: "storage",
      retryable: false,
    });
  });

  it("normalizes read failures", async () => {
    const repository = new IndexedDbArtifactRepository({
      openDatabase: () => Promise.reject(new Error("database unavailable")),
    });

    await expect(repository.get("artifact-1")).rejects.toMatchObject({
      code: "E_STORAGE_READ",
      stage: "storage",
      retryable: true,
    });
  });
});
