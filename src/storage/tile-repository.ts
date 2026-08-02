import { StoredTileRecordSchema, type StoredTileRecord } from "@shared/contracts/job";

import { requestResult, storageError, transactionDone } from "./indexeddb-helpers";
import { openWebCapDatabase, WEBCAP_STORES } from "./webcap-database";

export interface TileRepositoryPort {
  put(record: StoredTileRecord): Promise<void>;
  get(jobId: string, index: number): Promise<StoredTileRecord | undefined>;
  listByJob(jobId: string): Promise<StoredTileRecord[]>;
  deleteByJob(jobId: string): Promise<number>;
}

export interface IndexedDbTileRepositoryOptions {
  openDatabase?: () => Promise<IDBDatabase>;
}

function parseRecord(value: unknown): StoredTileRecord {
  return StoredTileRecordSchema.parse(value);
}

export class IndexedDbTileRepository implements TileRepositoryPort {
  private readonly openDatabase: () => Promise<IDBDatabase>;

  constructor(options: IndexedDbTileRepositoryOptions = {}) {
    this.openDatabase = options.openDatabase ?? (() => openWebCapDatabase());
  }

  async put(record: StoredTileRecord): Promise<void> {
    const validated = StoredTileRecordSchema.parse(record);
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.tiles, "readwrite");
      transaction.objectStore(WEBCAP_STORES.tiles).put(validated);
      await transactionDone(transaction);
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async get(jobId: string, index: number): Promise<StoredTileRecord | undefined> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.tiles, "readonly");
      const value = await requestResult(
        transaction.objectStore(WEBCAP_STORES.tiles).get([jobId, index]),
      );
      await transactionDone(transaction);
      return value === undefined ? undefined : parseRecord(value);
    } catch (error) {
      throw storageError("read", error);
    }
  }

  async listByJob(jobId: string): Promise<StoredTileRecord[]> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.tiles, "readonly");
      const store = transaction.objectStore(WEBCAP_STORES.tiles);
      const values = await requestResult(store.index("byJobId").getAll(jobId));
      await transactionDone(transaction);
      return values.map(parseRecord).sort((left, right) => left.index - right.index);
    } catch (error) {
      throw storageError("read", error);
    }
  }

  async deleteByJob(jobId: string): Promise<number> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.tiles, "readwrite");
      const store = transaction.objectStore(WEBCAP_STORES.tiles);
      const values = await requestResult(store.index("byJobId").getAll(jobId));
      const records = values.map(parseRecord);
      for (const record of records) {
        store.delete([record.jobId, record.index]);
      }
      await transactionDone(transaction);
      return records.length;
    } catch (error) {
      throw storageError("write", error);
    }
  }
}
