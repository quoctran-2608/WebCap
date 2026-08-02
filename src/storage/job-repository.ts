import { CaptureJobSchema, type CaptureJob } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

import { requestResult, storageError, transactionDone } from "./indexeddb-helpers";
import { openWebCapDatabase, WEBCAP_STORES } from "./webcap-database";

export interface JobRepositoryPort {
  create(job: CaptureJob): Promise<void>;
  get(jobId: string): Promise<CaptureJob | undefined>;
  save(job: CaptureJob, expectedRevision: number): Promise<void>;
  listActive(): Promise<CaptureJob[]>;
  listExpired(nowIso: string): Promise<CaptureJob[]>;
  delete(jobId: string): Promise<boolean>;
}

export interface IndexedDbJobRepositoryOptions {
  openDatabase?: () => Promise<IDBDatabase>;
}

function revisionConflict(
  jobId: string,
  expectedRevision: number,
  actualRevision: number | "missing" | "invalid-next-revision",
): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_WRITE",
      stage: "storage",
      message: "A newer capture job revision already exists.",
      userMessageKey: "errors.jobRevisionConflict",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "StateRevisionConflict",
      safeContext: {
        jobId,
        expectedRevision,
        actualRevision,
      },
    }),
  );
}

function parseJob(value: unknown): CaptureJob {
  const parsed = CaptureJobSchema.safeParse(value);
  if (!parsed.success) {
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_STORAGE_READ",
        stage: "storage",
        message: "Stored capture job does not match the current schema.",
        userMessageKey: "errors.jobStorageInvalid",
        retryable: false,
        fallbackAllowed: false,
        causeCode: "InvalidJobRecord",
      }),
    );
  }
  return parsed.data;
}

export class IndexedDbJobRepository implements JobRepositoryPort {
  private readonly openDatabase: () => Promise<IDBDatabase>;

  constructor(options: IndexedDbJobRepositoryOptions = {}) {
    this.openDatabase = options.openDatabase ?? (() => openWebCapDatabase());
  }

  async create(job: CaptureJob): Promise<void> {
    const validated = CaptureJobSchema.parse(job);
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.jobs, "readwrite");
      const store = transaction.objectStore(WEBCAP_STORES.jobs);
      const existing = await requestResult(store.get(validated.id));
      if (existing !== undefined) {
        throw revisionConflict(validated.id, 0, parseJob(existing).stateRevision);
      }
      store.add(validated);
      await transactionDone(transaction);
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async get(jobId: string): Promise<CaptureJob | undefined> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.jobs, "readonly");
      const value = await requestResult(
        transaction.objectStore(WEBCAP_STORES.jobs).get(jobId),
      );
      await transactionDone(transaction);
      return value === undefined ? undefined : parseJob(value);
    } catch (error) {
      throw storageError("read", error);
    }
  }

  async save(job: CaptureJob, expectedRevision: number): Promise<void> {
    const validated = CaptureJobSchema.parse(job);
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.jobs, "readwrite");
      const store = transaction.objectStore(WEBCAP_STORES.jobs);
      const value = await requestResult(store.get(validated.id));
      if (value === undefined) {
        throw revisionConflict(validated.id, expectedRevision, "missing");
      }

      const existing = parseJob(value);
      if (existing.stateRevision !== expectedRevision) {
        throw revisionConflict(validated.id, expectedRevision, existing.stateRevision);
      }
      if (validated.stateRevision !== expectedRevision + 1) {
        throw revisionConflict(validated.id, expectedRevision, "invalid-next-revision");
      }

      store.put(validated);
      await transactionDone(transaction);
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async listActive(): Promise<CaptureJob[]> {
    const jobs = await this.listAll();
    return jobs.filter((job) => job.state !== "completed" && job.state !== "cancelled");
  }

  async listExpired(nowIso: string): Promise<CaptureJob[]> {
    const jobs = await this.listAll();
    return jobs.filter((job) => job.expiresAt <= nowIso);
  }

  async delete(jobId: string): Promise<boolean> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.jobs, "readwrite");
      const store = transaction.objectStore(WEBCAP_STORES.jobs);
      const existing = await requestResult(store.get(jobId));
      if (existing === undefined) {
        await transactionDone(transaction);
        return false;
      }
      store.delete(jobId);
      await transactionDone(transaction);
      return true;
    } catch (error) {
      throw storageError("write", error);
    }
  }

  private async listAll(): Promise<CaptureJob[]> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.jobs, "readonly");
      const values = await requestResult(transaction.objectStore(WEBCAP_STORES.jobs).getAll());
      await transactionDone(transaction);
      return values.map(parseJob).sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    } catch (error) {
      throw storageError("read", error);
    }
  }
}
