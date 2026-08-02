import { StoredDedupeRecordSchema, type StoredDedupeRecord } from "@shared/contracts/job";

import { requestResult, storageError, transactionDone } from "./indexeddb-helpers";
import { openWebCapDatabase, WEBCAP_STORES } from "./webcap-database";

export interface DedupeRepositoryPort {
  get(requestId: string, nowIso: string): Promise<StoredDedupeRecord | undefined>;
  put(record: StoredDedupeRecord): Promise<void>;
  deleteExpired(nowIso: string): Promise<number>;
}

export interface IndexedDbDedupeRepositoryOptions {
  openDatabase?: () => Promise<IDBDatabase>;
}

export class IndexedDbDedupeRepository implements DedupeRepositoryPort {
  private readonly openDatabase: () => Promise<IDBDatabase>;

  constructor(options: IndexedDbDedupeRepositoryOptions = {}) {
    this.openDatabase = options.openDatabase ?? (() => openWebCapDatabase());
  }

  async get(requestId: string, nowIso: string): Promise<StoredDedupeRecord | undefined> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.dedupe, "readwrite");
      const store = transaction.objectStore(WEBCAP_STORES.dedupe);
      const value = await requestResult(store.get(requestId));
      if (value === undefined) {
        await transactionDone(transaction);
        return undefined;
      }

      const parsed = StoredDedupeRecordSchema.safeParse(value);
      if (!parsed.success || parsed.data.expiresAt <= nowIso) {
        store.delete(requestId);
        await transactionDone(transaction);
        return undefined;
      }

      await transactionDone(transaction);
      return parsed.data;
    } catch (error) {
      throw storageError("read", error);
    }
  }

  async put(record: StoredDedupeRecord): Promise<void> {
    const validated = StoredDedupeRecordSchema.parse(record);
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.dedupe, "readwrite");
      transaction.objectStore(WEBCAP_STORES.dedupe).put(validated);
      await transactionDone(transaction);
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async deleteExpired(nowIso: string): Promise<number> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.dedupe, "readwrite");
      const store = transaction.objectStore(WEBCAP_STORES.dedupe);
      const values = await requestResult(store.getAll());
      let deleted = 0;
      for (const value of values) {
        const parsed = StoredDedupeRecordSchema.safeParse(value);
        if (!parsed.success || parsed.data.expiresAt <= nowIso) {
          const requestId = parsed.success
            ? parsed.data.requestId
            : typeof value === "object" && value !== null && "requestId" in value
              ? (value as { requestId?: unknown }).requestId
              : undefined;
          if (typeof requestId === "string") {
            store.delete(requestId);
            deleted += 1;
          }
        }
      }
      await transactionDone(transaction);
      return deleted;
    } catch (error) {
      throw storageError("write", error);
    }
  }
}
