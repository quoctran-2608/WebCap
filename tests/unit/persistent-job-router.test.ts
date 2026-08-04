import { describe, expect, it, vi } from "vitest";

import {
  routePdfExportProgressMessage,
  routePersistentJobMessage,
  type PersistentJobRouterDependencies,
} from "@background/persistent-job-router";
import type { JobCleanupReport, PersistentJobCoordinatorPort } from "@background/job-coordinator";
import type { CaptureJob } from "@shared/contracts/domain";
import type { StoredDedupeRecord } from "@shared/contracts/job";
import {
  createJobCancelMessage,
  createJobCreateMessage,
  createJobGetMessage,
} from "@shared/contracts/job-messages";
import { createOffscreenPdfExportProgressMessage } from "@shared/contracts/offscreen";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { DedupeRepositoryPort } from "@storage/dedupe-repository";

const now = new Date("2026-08-02T16:00:00.000Z");

function job(id = "job-1"): CaptureJob {
  return {
    schemaVersion: 1,
    id,
    tabId: 7,
    windowId: 2,
    source: { createdAt: now.toISOString() },
    mode: "full-page",
    preferredEngine: "cdp",
    state: "created",
    stateRevision: 0,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: "2026-08-02T16:30:00.000Z",
  };
}

class MemoryDedupe implements DedupeRepositoryPort {
  readonly records = new Map<string, StoredDedupeRecord>();

  get(requestId: string): Promise<StoredDedupeRecord | undefined> {
    return Promise.resolve(this.records.get(requestId));
  }

  put(record: StoredDedupeRecord): Promise<void> {
    this.records.set(record.requestId, structuredClone(record));
    return Promise.resolve();
  }

  deleteExpired(): Promise<number> {
    return Promise.resolve(0);
  }
}

class FakeCoordinator implements PersistentJobCoordinatorPort {
  createCalls = 0;
  getCalls = 0;
  current: CaptureJob | undefined = job();

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  create(): Promise<CaptureJob> {
    this.createCalls += 1;
    return Promise.resolve(job());
  }

  get(): Promise<CaptureJob | undefined> {
    this.getCalls += 1;
    return Promise.resolve(this.current);
  }

  update(): Promise<CaptureJob> {
    return Promise.resolve(job());
  }

  transition(): Promise<CaptureJob> {
    return Promise.resolve(job());
  }

  cancel(): Promise<CaptureJob> {
    return Promise.resolve({
      ...job(),
      state: "cancelled",
      stateRevision: 3,
      cleanup: { attempted: true, completed: true },
      error: {
        code: "E_CANCELLED",
        stage: "cleanup",
        message: "cancelled",
        userMessageKey: "errors.cancelled",
        retryable: true,
        fallbackAllowed: false,
      },
    });
  }

  cleanupExpired(): Promise<JobCleanupReport> {
    return Promise.resolve({
      deletedJobs: 0,
      skippedLeasedJobs: 0,
      failedJobs: 0,
      deletedTiles: 0,
      deletedArtifacts: 0,
    });
  }
}

function dependencies(
  jobs: FakeCoordinator,
  dedupe: MemoryDedupe,
  captures?: PersistentJobRouterDependencies["captures"],
): PersistentJobRouterDependencies {
  return { jobs, dedupe, now: () => now, ...(captures === undefined ? {} : { captures }) };
}

describe("persistent job router", () => {
  it("returns the stored response for duplicate JOB_CREATE requestIds", async () => {
    const jobs = new FakeCoordinator();
    const dedupe = new MemoryDedupe();
    const message = createJobCreateMessage({
      requestId: "request-1",
      sentAt: now.toISOString(),
      tabId: 7,
      windowId: 2,
      mode: "full-page",
      settings: DEFAULT_CAPTURE_SETTINGS,
    });

    const first = await routePersistentJobMessage(message, dependencies(jobs, dedupe));
    jobs.current = job("job-changed");
    const second = await routePersistentJobMessage(message, dependencies(jobs, dedupe));

    expect(first).toEqual(second);
    expect(jobs.createCalls).toBe(1);
    expect(dedupe.records.get("request-1")).toMatchObject({ requestType: "JOB_CREATE" });
  });

  it("starts a full-page execution once after creating its persistent job", async () => {
    const jobs = new FakeCoordinator();
    const dedupe = new MemoryDedupe();
    const start = vi.fn(() => Promise.resolve());
    const cancel = vi.fn(() => Promise.resolve(job()));
    const message = createJobCreateMessage({
      requestId: "request-start",
      sentAt: now.toISOString(),
      tabId: 7,
      windowId: 2,
      mode: "full-page",
      settings: DEFAULT_CAPTURE_SETTINGS,
    });

    const response = await routePersistentJobMessage(
      message,
      dependencies(jobs, dedupe, { start, cancel }),
    );
    await Promise.resolve();

    expect(response).toMatchObject({ type: "JOB_RESPONSE", payload: { job: { id: "job-1" } } });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith("job-1");
  });

  it("routes active full-page cancellation through the execution coordinator", async () => {
    const jobs = new FakeCoordinator();
    const dedupe = new MemoryDedupe();
    const cancelled = { ...job(), state: "capturing" as const, stateRevision: 2 };
    jobs.current = cancelled;
    const start = vi.fn(() => Promise.resolve());
    const cancel = vi.fn(() => Promise.resolve(cancelled));
    const message = createJobCancelMessage({
      requestId: "request-cancel",
      sentAt: now.toISOString(),
      jobId: cancelled.id,
      reason: "test",
    });

    const response = await routePersistentJobMessage(
      message,
      dependencies(jobs, dedupe, { start, cancel }),
    );

    expect(cancel).toHaveBeenCalledWith(cancelled.id, "test");
    expect(response).toMatchObject({
      type: "JOB_RESPONSE",
      payload: { job: { state: "capturing" } },
    });
  });

  it("caches normalized errors for duplicate missing-job reads", async () => {
    const jobs = new FakeCoordinator();
    jobs.current = undefined;
    const dedupe = new MemoryDedupe();
    const message = createJobGetMessage({
      requestId: "request-2",
      sentAt: now.toISOString(),
      jobId: "missing",
    });

    const first = await routePersistentJobMessage(message, dependencies(jobs, dedupe));
    jobs.current = job();
    const second = await routePersistentJobMessage(message, dependencies(jobs, dedupe));

    expect(first).toEqual(second);
    expect(first).toMatchObject({ type: "ERROR_RESPONSE", payload: { code: "E_STORAGE_READ" } });
    expect(jobs.getCalls).toBe(1);
  });

  it("acknowledges progress while an exporting job remains active even if persistence fails", async () => {
    const jobs = new FakeCoordinator();
    jobs.current = {
      ...job(),
      state: "exporting",
      stateRevision: 4,
      exportProgress: { completedPages: 0, totalPages: 3 },
    };
    const dedupe = new MemoryDedupe();
    const message = createOffscreenPdfExportProgressMessage({
      requestId: "progress-1",
      sentAt: now.toISOString(),
      jobId: jobs.current.id,
      completedPages: 1,
      totalPages: 3,
    });
    const response = await routePdfExportProgressMessage(message, {
      ...dependencies(jobs, dedupe),
      pdfExports: {
        start: () => Promise.resolve(jobs.current as CaptureJob),
        handleProgress: () => Promise.reject(new Error("progress persistence failed")),
      },
    });

    expect(response).toMatchObject({
      type: "OFFSCREEN_PDF_EXPORT_PROGRESS_ACK",
      payload: { jobId: jobs.current.id, accepted: true },
    });
  });

  it("ignores unrelated runtime messages", async () => {
    const jobs = new FakeCoordinator();
    const dedupe = new MemoryDedupe();
    const response = await routePersistentJobMessage(
      { type: "PING", target: "background" },
      dependencies(jobs, dedupe),
    );
    expect(response).toBeUndefined();
  });
});
