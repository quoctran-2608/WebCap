import type { ArtifactRecord } from "@shared/contracts/artifact";

import { requestResult, storageError, transactionDone } from "./indexeddb-helpers";
import { openWebCapDatabase, WEBCAP_STORES } from "./webcap-database";

export interface JobArtifactCleanupPort {
  deleteByJob(jobId: string): Promise<number>;
}

export interface IndexedDbJobArtifactCleanupRepositoryOptions {
  openDatabase?: () => Promise<IDBDatabase>;
}

export class IndexedDbJobArtifactCleanupRepository implements JobArtifactCleanupPort {
  private readonly openDatabase: () => Promise<IDBDatabase>;

  constructor(options: IndexedDbJobArtifactCleanupRepositoryOptions = {}) {
    this.openDatabase = options.openDatabase ?? (() => openWebCapDatabase());
  }

  async deleteByJob(jobId: string): Promise<number> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.artifacts, "readwrite");
      const store = transaction.objectStore(WEBCAP_STORES.artifacts);
      const values = (await requestResult(
        store.index("byJobId").getAll(jobId),
      )) as ArtifactRecord[];
      for (const record of values) {
        store.delete(record.artifactId);
      }
      await transactionDone(transaction);
      return values.length;
    } catch (error) {
      throw storageError("write", error);
    }
  }
}
