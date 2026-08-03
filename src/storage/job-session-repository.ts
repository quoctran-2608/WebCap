import { JOB_SESSION_SCHEMA_VERSION, JOB_SESSION_STORAGE_KEY } from "@shared/constants";
import {
  JobSessionStateSchema,
  JobSummarySchema,
  TabJobLockSchema,
  type JobSessionState,
  type JobSummary,
  type TabJobLock,
} from "@shared/contracts/job";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

export interface JobSessionStorageAdapter {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface JobSessionRepositoryPort {
  getSummary(jobId: string): Promise<JobSummary | undefined>;
  listSummaries(): Promise<JobSummary[]>;
  saveSummary(summary: JobSummary): Promise<void>;
  getTabLock(tabId: number): Promise<TabJobLock | undefined>;
  acquireTabLock(lock: TabJobLock, nowIso: string): Promise<boolean>;
  releaseTabLock(tabId: number, jobId: string): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
  clearExpiredLocks(nowIso: string): Promise<number>;
}

export const chromeJobSessionStorageAdapter: JobSessionStorageAdapter = {
  get: (key) => chrome.storage.session.get(key),
  set: (items) => chrome.storage.session.set(items),
  remove: (key) => chrome.storage.session.remove(key),
};

function emptyState(): JobSessionState {
  return {
    schemaVersion: JOB_SESSION_SCHEMA_VERSION,
    summaries: [],
    locks: [],
  };
}

function sessionStorageError(operation: "read" | "write", error: unknown): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: operation === "read" ? "E_STORAGE_READ" : "E_STORAGE_WRITE",
      stage: "storage",
      message: `WebCap could not ${operation} active job session metadata.`,
      userMessageKey: operation === "read" ? "errors.jobSessionRead" : "errors.jobSessionWrite",
      retryable: true,
      fallbackAllowed: false,
      causeCode: error instanceof Error ? error.name : "JobSessionStorageFailure",
    }),
  );
}

export class JobSessionRepository implements JobSessionRepositoryPort {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: JobSessionStorageAdapter = chromeJobSessionStorageAdapter,
  ) {}

  async getSummary(jobId: string): Promise<JobSummary | undefined> {
    const state = await this.readState();
    return state.summaries.find((summary) => summary.jobId === jobId);
  }

  async listSummaries(): Promise<JobSummary[]> {
    const state = await this.readState();
    return [...state.summaries];
  }

  saveSummary(summary: JobSummary): Promise<void> {
    const validated = JobSummarySchema.parse(summary);
    return this.mutate(async () => {
      const state = await this.readState();
      await this.writeState({
        ...state,
        summaries: [
          ...state.summaries.filter((candidate) => candidate.jobId !== validated.jobId),
          validated,
        ],
      });
    });
  }

  async getTabLock(tabId: number): Promise<TabJobLock | undefined> {
    const state = await this.readState();
    return state.locks.find((lock) => lock.tabId === tabId);
  }

  acquireTabLock(lock: TabJobLock, nowIso: string): Promise<boolean> {
    const validated = TabJobLockSchema.parse(lock);
    return this.mutate(async () => {
      const state = await this.readState();
      const existing = state.locks.find((candidate) => candidate.tabId === validated.tabId);
      if (
        existing !== undefined &&
        existing.jobId !== validated.jobId &&
        existing.leaseExpiresAt > nowIso
      ) {
        return false;
      }

      await this.writeState({
        ...state,
        locks: [
          ...state.locks.filter((candidate) => candidate.tabId !== validated.tabId),
          validated,
        ],
      });
      return true;
    });
  }

  releaseTabLock(tabId: number, jobId: string): Promise<void> {
    return this.mutate(async () => {
      const state = await this.readState();
      await this.writeState({
        ...state,
        locks: state.locks.filter((lock) => !(lock.tabId === tabId && lock.jobId === jobId)),
      });
    });
  }

  deleteJob(jobId: string): Promise<void> {
    return this.mutate(async () => {
      const state = await this.readState();
      await this.writeState({
        ...state,
        summaries: state.summaries.filter((summary) => summary.jobId !== jobId),
        locks: state.locks.filter((lock) => lock.jobId !== jobId),
      });
    });
  }

  clearExpiredLocks(nowIso: string): Promise<number> {
    return this.mutate(async () => {
      const state = await this.readState();
      const retained = state.locks.filter((lock) => lock.leaseExpiresAt > nowIso);
      const deleted = state.locks.length - retained.length;
      if (deleted > 0) {
        await this.writeState({ ...state, locks: retained });
      }
      return deleted;
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readState(): Promise<JobSessionState> {
    try {
      const stored = await this.storage.get(JOB_SESSION_STORAGE_KEY);
      const value = stored[JOB_SESSION_STORAGE_KEY];
      if (value === undefined) {
        return emptyState();
      }

      const parsed = JobSessionStateSchema.safeParse(value);
      if (parsed.success) {
        return parsed.data;
      }

      await this.storage.remove(JOB_SESSION_STORAGE_KEY);
      return emptyState();
    } catch (error) {
      throw sessionStorageError("read", error);
    }
  }

  private async writeState(state: JobSessionState): Promise<void> {
    try {
      const validated = JobSessionStateSchema.parse(state);
      await this.storage.set({ [JOB_SESSION_STORAGE_KEY]: validated });
    } catch (error) {
      throw sessionStorageError("write", error);
    }
  }
}
