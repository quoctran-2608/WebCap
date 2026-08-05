import type { ArtifactRecord } from "@shared/contracts/artifact";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

import { openWebCapDatabase, WEBCAP_STORES } from "./webcap-database";

export interface ArtifactRepositoryPort {
  put(record: ArtifactRecord): Promise<void>;
  get(artifactId: string): Promise<ArtifactRecord | undefined>;
  delete(artifactId: string): Promise<boolean>;
  deleteExpired(nowIso: string): Promise<number>;
}

export interface JobArtifactLookupPort {
  listByJob(jobId: string): Promise<ArtifactRecord[]>;
}

export interface IndexedDbArtifactRepositoryOptions {
  openDatabase?: () => Promise<IDBDatabase>;
}

function storageError(operation: "read" | "write", error: unknown): Error {
  const causeCode = error instanceof DOMException ? error.name : undefined;
  const quota = causeCode === "QuotaExceededError";

  return createWebCapRuntimeError(
    createWebCapError({
      code: quota ? "E_STORAGE_QUOTA" : operation === "read" ? "E_STORAGE_READ" : "E_STORAGE_WRITE",
      stage: "storage",
      message: quota
        ? "WebCap local artifact storage quota was exceeded."
        : `WebCap could not ${operation} local artifact storage.`,
      userMessageKey: quota
        ? "errors.storageQuota"
        : operation === "read"
          ? "errors.storageRead"
          : "errors.storageWrite",
      retryable: !quota,
      fallbackAllowed: false,
      ...(causeCode === undefined ? {} : { causeCode }),
    }),
  );
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function requestResult(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export class IndexedDbArtifactRepository
  implements ArtifactRepositoryPort, JobArtifactLookupPort
{
  private readonly openDatabase: () => Promise<IDBDatabase>;

  constructor(options: IndexedDbArtifactRepositoryOptions = {}) {
    this.openDatabase = options.openDatabase ?? (() => openWebCapDatabase());
  }

  async put(record: ArtifactRecord): Promise<void> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.artifacts, "readwrite");
      const completed = transactionDone(transaction);
      transaction.objectStore(WEBCAP_STORES.artifacts).put(record);
      await completed;
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async get(artifactId: string): Promise<ArtifactRecord | undefined> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.artifacts, "readonly");
      return (await requestResult(
        transaction.objectStore(WEBCAP_STORES.artifacts).get(artifactId),
      )) as ArtifactRecord | undefined;
    } catch (error) {
      throw storageError("read", error);
    }
  }

  async listByJob(jobId: string): Promise<ArtifactRecord[]> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.artifacts, "readonly");
      const records = (await requestResult(
        transaction.objectStore(WEBCAP_STORES.artifacts).index("byJobId").getAll(jobId),
      )) as ArtifactRecord[];
      return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    } catch (error) {
      throw storageError("read", error);
    }
  }

  async delete(artifactId: string): Promise<boolean> {
    try {
      const existing = await this.get(artifactId);
      if (existing === undefined) return false;

      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.artifacts, "readwrite");
      const completed = transactionDone(transaction);
      transaction.objectStore(WEBCAP_STORES.artifacts).delete(artifactId);
      await completed;
      return true;
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async deleteExpired(nowIso: string): Promise<number> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.artifacts, "readwrite");
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(WEBCAP_STORES.artifacts);
      const records = (await requestResult(store.getAll())) as ArtifactRecord[];
      let deleted = 0;

      for (const record of records) {
        if (record.expiresAt <= nowIso) {
          store.delete(record.artifactId);
          deleted += 1;
        }
      }

      await completed;
      return deleted;
    } catch (error) {
      throw storageError("write", error);
    }
  }
}
