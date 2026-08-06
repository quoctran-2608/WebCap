import { describe, expect, it } from "vitest";

import { PersistentJobCoordinator, type JobCleanupPort } from "@background/job-coordinator";
import type { JobSummaryEventPublisherPort } from "@background/job-event-publisher";
import type { CaptureJob } from "@shared/contracts/domain";
import type { JobSummary, TabJobLock } from "@shared/contracts/job";
import { summarizeJob } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { JobArtifactCleanupPort } from "@storage/job-artifact-cleanup-repository";
import type { JobRepositoryPort } from "@storage/job-repository";
import type { JobSessionRepositoryPort } from "@storage/job-session-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

class MemoryJobs implements JobRepositoryPort {
  readonly records = new Map<string, CaptureJob>();

  create(job: CaptureJob): Promise<void> {
    if (this.records.has(job.id)) {
      return Promise.reject(new Error("duplicate"));
    }
    this.records.set(job.id, structuredClone(job));
    return Promise.resolve();
  }

  get(jobId: string): Promise<CaptureJob | undefined> {
    const job = this.records.get(jobId);
    return Promise.resolve(job === undefined ? undefined : structuredClone(job));
  }

  save(job: CaptureJob, expectedRevision: number): Promise<void> {
    const existing = this.records.get(job.id);
    if (existing?.stateRevision !== expectedRevision) {
      return Promise.reject(new Error("revision conflict"));
    }
    this.records.set(job.id, structuredClone(job));
    return Promise.resolve();
  }

  listActive(): Promise<CaptureJob[]> {
    return Promise.resolve(
      [...this.records.values()]
        .filter((job) => job.state !== "completed" && job.state !== "cancelled")
        .map((job) => structuredClone(job)),
    );
  }

  listExpired(nowIso: string): Promise<CaptureJob[]> {
    return Promise.resolve(
      [...this.records.values()]
        .filter((job) => job.expiresAt <= nowIso)
        .map((job) => structuredClone(job)),
    );
  }

  delete(jobId: string): Promise<boolean> {
    return Promise.resolve(this.records.delete(jobId));
  }
}

class MemorySessions implements JobSessionRepositoryPort {
  readonly summaries = new Map<string, JobSummary>();
  readonly locks = new Map<number, TabJobLock>();

  getSummary(jobId: string): Promise<JobSummary | undefined> {
    return Promise.resolve(this.summaries.get(jobId));
  }

  listSummaries(): Promise<JobSummary[]> {
    return Promise.resolve([...this.summaries.values()]);
  }

  saveSummary(summary: JobSummary): Promise<void> {
    this.summaries.set(summary.jobId, structuredClone(summary));
    return Promise.resolve();
  }

  getTabLock(tabId: number): Promise<TabJobLock | undefined> {
    return Promise.resolve(this.locks.get(tabId));
  }

  acquireTabLock(lock: TabJobLock, nowIso: string): Promise<boolean> {
    const existing = this.locks.get(lock.tabId);
    if (
      existing !== undefined &&
      existing.jobId !== lock.jobId &&
      existing.leaseExpiresAt > nowIso
    ) {
      return Promise.resolve(false);
    }
    this.locks.set(lock.tabId, structuredClone(lock));
    return Promise.resolve(true);
  }

  releaseTabLock(tabId: number, jobId: string): Promise<void> {
    if (this.locks.get(tabId)?.jobId === jobId) {
      this.locks.delete(tabId);
    }
    return Promise.resolve();
  }

  deleteJob(jobId: string): Promise<void> {
    this.summaries.delete(jobId);
    for (const [tabId, lock] of this.locks) {
      if (lock.jobId === jobId) {
        this.locks.delete(tabId);
      }
    }
    return Promise.resolve();
  }

  clearExpiredLocks(nowIso: string): Promise<number> {
    let deleted = 0;
    for (const [tabId, lock] of this.locks) {
      if (lock.leaseExpiresAt <= nowIso) {
        this.locks.delete(tabId);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }
}

class MemoryTiles implements TileRepositoryPort {
  deletedJobs: string[] = [];

  put(): Promise<void> {
    return Promise.resolve();
  }

  get(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  listByJob(): Promise<[]> {
    return Promise.resolve([]);
  }

  deleteByJob(jobId: string): Promise<number> {
    this.deletedJobs.push(jobId);
    return Promise.resolve(2);
  }
}

class MemoryArtifacts implements JobArtifactCleanupPort {
  deletedJobs: string[] = [];

  deleteByJob(jobId: string): Promise<number> {
    this.deletedJobs.push(jobId);
    return Promise.resolve(1);
  }
}

function storedJob(state: CaptureJob["state"], options: Partial<CaptureJob> = {}): CaptureJob {
  const cleanupSettled = state === "completed" || state === "failed" || state === "cancelled";
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { createdAt: "2026-08-02T16:00:00.000Z" },
    mode: "full-page",
    preferredEngine: "cdp",
    state,
    stateRevision: 2,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: cleanupSettled
      ? { attempted: true, completed: true }
      : { attempted: false, completed: false },
    createdAt: "2026-08-02T16:00:00.000Z",
    updatedAt: "2026-08-02T16:01:00.000Z",
    expiresAt: "2026-08-02T16:30:00.000Z",
    ...(state === "failed"
      ? {
          error: {
            code: "E_UNKNOWN" as const,
            stage: "storage" as const,
            message: "failed",
            userMessageKey: "errors.failed",
            retryable: true,
            fallbackAllowed: false,
          },
        }
      : {}),
    ...options,
  };
}

function setup(
  options: {
    now?: Date;
    cleanup?: JobCleanupPort;
    events?: JobSummaryEventPublisherPort;
    id?: string;
  } = {},
) {
  const jobs = new MemoryJobs();
  const sessions = new MemorySessions();
  const tiles = new MemoryTiles();
  const artifacts = new MemoryArtifacts();
  const published: JobSummary[] = [];
  const events: JobSummaryEventPublisherPort = options.events ?? {
    publish(summary) {
      published.push(structuredClone(summary));
      return Promise.resolve();
    },
  };
  const coordinator = new PersistentJobCoordinator({
    jobs,
    sessions,
    tiles,
    artifacts,
    events,
    now: () => options.now ?? new Date("2026-08-02T16:02:00.000Z"),
    idFactory: () => options.id ?? "job-created",
    ...(options.cleanup === undefined ? {} : { cleanup: options.cleanup }),
  });
  return { coordinator, jobs, sessions, tiles, artifacts, published };
}

describe("PersistentJobCoordinator", () => {
  it("creates one active job per tab and persists its summary and lock", async () => {
    const { coordinator, sessions, published } = setup();
    const created = await coordinator.create({
      tabId: 7,
      windowId: 2,
      mode: "full-page",
      settings: DEFAULT_CAPTURE_SETTINGS,
    });
    expect(created).toMatchObject({
      id: "job-created",
      state: "created",
      stateRevision: 0,
      completionPolicy: {
        primaryOutput: "pdf",
        autoExport: true,
        openEditorAfterCapture: false,
        allowGuardedImageFallback: false,
      },
    });
    expect(sessions.summaries.get(created.id)).toEqual(summarizeJob(created));
    expect(sessions.locks.get(7)).toMatchObject({ jobId: created.id });
    expect(published).toEqual([summarizeJob(created)]);
    await expect(
      coordinator.create({
        tabId: 7,
        windowId: 2,
        mode: "full-page",
        settings: DEFAULT_CAPTURE_SETTINGS,
      }),
    ).rejects.toMatchObject({ code: "E_CAPTURE_RATE_LIMIT" });
  });

  it("keeps durable transitions successful when event delivery fails", async () => {
    let eventCalls = 0;
    const { coordinator, sessions } = setup({
      events: {
        publish() {
          eventCalls += 1;
          return Promise.reject(new Error("popup closed"));
        },
      },
    });
    const created = await coordinator.create({
      tabId: 7,
      windowId: 2,
      mode: "full-page",
      settings: DEFAULT_CAPTURE_SETTINGS,
    });

    const preparing = await coordinator.transition(created.id, "preparing");

    expect(preparing).toMatchObject({ state: "preparing", stateRevision: 1 });
    expect(sessions.summaries.get(created.id)).toEqual(summarizeJob(preparing));
    expect(eventCalls).toBe(2);
  });

  it("prefers an active job and restores the latest durable terminal job for a tab", async () => {
    const { coordinator, jobs, sessions } = setup();
    const older = storedJob("completed", {
      id: "job-completed-older",
      updatedAt: "2026-08-02T16:00:30.000Z",
    });
    const latest = storedJob("completed", {
      id: "job-completed-latest",
      updatedAt: "2026-08-02T16:01:30.000Z",
    });
    const active = storedJob("created", {
      id: "job-active",
      updatedAt: "2026-08-02T16:01:00.000Z",
      cleanup: { attempted: false, completed: false },
    });
    jobs.records.set(older.id, older);
    jobs.records.set(latest.id, latest);
    jobs.records.set(active.id, active);
    sessions.summaries.set(older.id, summarizeJob(older));
    sessions.summaries.set(latest.id, summarizeJob(latest));

    await expect(coordinator.getActiveForTab(7)).resolves.toMatchObject({ id: active.id });

    jobs.records.delete(active.id);
    await expect(coordinator.getActiveForTab(7)).resolves.toMatchObject({ id: latest.id });
  });

  it("cancels a created job through legal transitions and releases the lock", async () => {
    let cleanupCalls = 0;
    const { coordinator, sessions } = setup({
      cleanup: {
        cleanup: () => {
          cleanupCalls += 1;
          return Promise.resolve();
        },
      },
    });
    const created = await coordinator.create({
      tabId: 7,
      windowId: 2,
      mode: "full-page",
      settings: DEFAULT_CAPTURE_SETTINGS,
    });
    const cancelled = await coordinator.cancel(created.id, "test");
    expect(cancelled).toMatchObject({
      state: "cancelled",
      stateRevision: 3,
      cleanup: { attempted: true, completed: true },
      error: { code: "E_CANCELLED" },
    });
    expect(cleanupCalls).toBe(1);
    expect(sessions.locks.has(7)).toBe(false);
  });

  it("recovers an interrupted capturing job as retryable failed", async () => {
    const { coordinator, jobs, sessions } = setup();
    const interrupted = storedJob("capturing", {
      activeEngine: "cdp",
      tilePlan: [
        {
          id: "tile-0",
          jobId: "job-1",
          index: 0,
          row: 0,
          column: 0,
          sourceRectCss: { x: 0, y: 0, width: 100, height: 100 },
          expectedPixelWidth: 100,
          expectedPixelHeight: 100,
          overlapTopCss: 0,
          overlapLeftCss: 0,
          status: "capturing",
          attempts: 1,
        },
      ],
      totalTiles: 1,
    });
    jobs.records.set(interrupted.id, interrupted);
    await coordinator.initialize();
    expect(jobs.records.get(interrupted.id)).toMatchObject({
      state: "failed",
      stateRevision: 3,
      cleanup: { attempted: true, completed: true },
      error: { causeCode: "ServiceWorkerRestart", retryable: true },
    });
    expect(sessions.summaries.get(interrupted.id)).toMatchObject({ state: "failed" });
    expect(sessions.locks.get(7)).toMatchObject({ jobId: interrupted.id });
  });

  it("does not delete an expired job while a valid lease is active", async () => {
    const { coordinator, jobs, sessions, tiles, artifacts } = setup();
    const completed = storedJob("completed", {
      expiresAt: "2026-08-02T16:01:00.000Z",
    });
    jobs.records.set(completed.id, completed);
    sessions.locks.set(7, {
      schemaVersion: 1,
      tabId: 7,
      jobId: completed.id,
      acquiredAt: "2026-08-02T16:00:00.000Z",
      leaseExpiresAt: "2026-08-02T16:10:00.000Z",
    });
    await coordinator.initialize();
    expect(jobs.records.has(completed.id)).toBe(true);
    expect(tiles.deletedJobs).toEqual([]);
    expect(artifacts.deletedJobs).toEqual([]);
  });

  it("deletes expired job, tile, artifact, summary, and lock data", async () => {
    const { coordinator, jobs, sessions, tiles, artifacts } = setup();
    const completed = storedJob("completed", {
      expiresAt: "2026-08-02T16:01:00.000Z",
    });
    jobs.records.set(completed.id, completed);
    sessions.summaries.set(completed.id, summarizeJob(completed));
    await coordinator.initialize();
    expect(jobs.records.has(completed.id)).toBe(false);
    expect(sessions.summaries.has(completed.id)).toBe(false);
    expect(tiles.deletedJobs).toEqual([completed.id]);
    expect(artifacts.deletedJobs).toEqual([completed.id]);
  });
});
