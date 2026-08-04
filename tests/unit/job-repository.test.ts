import { describe, expect, it } from "vitest";

import type { CaptureJob } from "@shared/contracts/domain";
import { WebCapRuntimeError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import { IndexedDbJobRepository } from "@storage/job-repository";

const timestamp = "2026-08-02T16:00:00.000Z";

function job(revision: number): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { createdAt: timestamp },
    mode: "full-page",
    preferredEngine: "cdp",
    state: revision === 0 ? "created" : "preparing",
    stateRevision: revision,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: "2026-08-02T16:30:00.000Z",
  };
}

interface FakeRequest {
  result: unknown;
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface FakeTransaction {
  error: DOMException | null;
  oncomplete: (() => void) | null;
  onabort: (() => void) | null;
  onerror: (() => void) | null;
  objectStore(): {
    get(): IDBRequest;
    put(): IDBRequest;
  };
}

function request(value: unknown): IDBRequest {
  const fake: FakeRequest = {
    result: value,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  queueMicrotask(() => fake.onsuccess?.());
  return fake as unknown as IDBRequest;
}

function databaseWithStoredJob(stored: CaptureJob): IDBDatabase {
  const transaction: FakeTransaction = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore: () => ({
      get: () => request(stored),
      put: () => {
        const result = request(undefined);
        setTimeout(() => transaction.oncomplete?.(), 0);
        return result;
      },
    }),
  };
  return {
    transaction: () => transaction as unknown as IDBTransaction,
  } as unknown as IDBDatabase;
}

async function runtimeRejection(operation: Promise<unknown>): Promise<WebCapRuntimeError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(WebCapRuntimeError);
    if (error instanceof WebCapRuntimeError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the repository operation to reject.");
}

describe("IndexedDbJobRepository", () => {
  it("resolves readonly job requests without waiting for transaction completion", async () => {
    const stored = job(1);
    const repository = new IndexedDbJobRepository({
      openDatabase: () => Promise.resolve(databaseWithStoredJob(stored)),
    });

    await expect(repository.get(stored.id)).resolves.toEqual(stored);
  });

  it("rejects stale compare-and-set writes", async () => {
    const repository = new IndexedDbJobRepository({
      openDatabase: () => Promise.resolve(databaseWithStoredJob(job(2))),
    });

    const error = await runtimeRejection(repository.save(job(2), 1));
    expect(error.code).toBe("E_STORAGE_WRITE");
    expect(error.data).toMatchObject({
      causeCode: "StateRevisionConflict",
      safeContext: {
        expectedRevision: 1,
        actualRevision: 2,
      },
    });
  });

  it("rejects a candidate that does not advance exactly one revision", async () => {
    const repository = new IndexedDbJobRepository({
      openDatabase: () => Promise.resolve(databaseWithStoredJob(job(1))),
    });

    const error = await runtimeRejection(repository.save(job(1), 1));
    expect(error.code).toBe("E_STORAGE_WRITE");
    expect(error.data).toMatchObject({
      causeCode: "StateRevisionConflict",
      safeContext: {
        expectedRevision: 1,
        actualRevision: "invalid-next-revision",
      },
    });
  });

  it("normalizes transaction creation failures", async () => {
    const database = {
      transaction: () => {
        throw new DOMException("transaction failed", "InvalidStateError");
      },
    } as unknown as IDBDatabase;
    const repository = new IndexedDbJobRepository({
      openDatabase: () => Promise.resolve(database),
    });

    const error = await runtimeRejection(repository.get("job-1"));
    expect(error).toMatchObject({
      code: "E_STORAGE_READ",
      stage: "storage",
    });
    expect(error.data.causeCode).toBe("InvalidStateError");
  });
});
