import { describe, expect, it } from "vitest";

import { PersistentJobCoordinator } from "@background/job-coordinator";
import type { JobSummaryEventPublisherPort } from "@background/job-event-publisher";
import type { CaptureJob } from "@shared/contracts/domain";
import type { JobSummary, TabJobLock } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { JobArtifactCleanupPort } from "@storage/job-artifact-cleanup-repository";
import type { JobRepositoryPort } from "@storage/job-repository";
import type { JobSessionRepositoryPort } from "@storage/job-session-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

class MemoryJobs implements JobRepositoryPort {
  readonly records = new Map<string, CaptureJob>();

  create(job: CaptureJob): Promise<void> {
    this.records.set(job.id, structuredClone(job));
    return Promise.resolve();
  }

  get(jobId: string): Promise<CaptureJob | undefined> {
    const job = this.records.get(jobId);
    return Promise.resolve(job === undefined ? undefined : structuredClone(job));
  }

  save(job: CaptureJob, expectedRevision: number): Promise<void> {
    const current = this.records.get(job.id);
    if (current?.stateRevision !== expectedRevision) {
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
    return Promise.resolve([...this.summaries.values()].map((summary) => structuredClone(summary)));
  }

  saveSummary(summary: JobSummary): Promise<void> {
    this.summaries.set(summary.jobId, structuredClone(summary));
    return Promise.resolve();
  }

  getTabLock(tabId: number): Promise<TabJobLock | undefined> {
    const lock = this.locks.get(tabId);
    return Promise.resolve(lock === undefined ? undefined : structuredClone(lock));
  }

  acquireTabLock(lock: TabJobLock, nowIso: string): Promise<boolean> {
    const current = this.locks.get(lock.tabId);
    if (current !== undefined && current.jobId !== lock.jobId && current.leaseExpiresAt > nowIso) {
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
  put(): Promise<void> {
    return Promise.resolve();
  }

  get(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  listByJob(): Promise<[]> {
    return Promise.resolve([]);
  }

  deleteByJob(): Promise<number> {
    return Promise.resolve(0);
  }
}

class MemoryArtifacts implements JobArtifactCleanupPort {
  deleteByJob(): Promise<number> {
    return Promise.resolve(0);
  }
}

function interruptedJob(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-interrupted",
    tabId: 7,
    windowId: 2,
    source: { createdAt: "2026-08-06T00:00:00.000Z" },
    mode: "full-page",
    preferredEngine: "cdp",
    activeEngine: "cdp",
    state: "capturing",
    stateRevision: 4,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:01:00.000Z",
    expiresAt: "2026-08-06T00:30:00.000Z",
  };
}

function setup() {
  const jobs = new MemoryJobs();
  const sessions = new MemorySessions();
  const published: JobSummary[] = [];
  const events: JobSummaryEventPublisherPort = {
    publish(summary) {
      published.push(structuredClone(summary));
      return Promise.resolve();
    },
  };
  const coordinator = new PersistentJobCoordinator({
    jobs,
    sessions,
    tiles: new MemoryTiles(),
    artifacts: new MemoryArtifacts(),
    events,
    now: () => new Date("2026-08-06T00:02:00.000Z"),
    idFactory: () => "job-events",
  });
  return { coordinator, jobs, sessions, published };
}

describe("PersistentJobCoordinator event coverage", () => {
  it("publishes every revision for update and cancellation through the terminal state", async () => {
    const { coordinator, published } = setup();
    const created = await coordinator.create({
      tabId: 7,
      windowId: 2,
      mode: "full-page",
      settings: DEFAULT_CAPTURE_SETTINGS,
    });

    const updated = await coordinator.update(created.id, { activeEngine: "scroll" });
    const cancelled = await coordinator.cancel(created.id, "event coverage");

    expect(updated).toMatchObject({ state: "created", stateRevision: 1, activeEngine: "scroll" });
    expect(cancelled).toMatchObject({ state: "cancelled", stateRevision: 4 });
    expect(
      published.map((summary) => ({ state: summary.state, revision: summary.stateRevision })),
    ).toEqual([
      { state: "created", revision: 0 },
      { state: "created", revision: 1 },
      { state: "preparing", revision: 2 },
      { state: "cancelling", revision: 3 },
      { state: "cancelled", revision: 4 },
    ]);
  });

  it("publishes exactly one retryable failed revision during worker recovery", async () => {
    const { coordinator, jobs, sessions, published } = setup();
    const interrupted = interruptedJob();
    jobs.records.set(interrupted.id, interrupted);

    await coordinator.initialize();

    expect(jobs.records.get(interrupted.id)).toMatchObject({
      state: "failed",
      stateRevision: 5,
      error: { causeCode: "ServiceWorkerRestart", retryable: true },
    });
    expect(sessions.locks.get(interrupted.tabId)).toMatchObject({ jobId: interrupted.id });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      jobId: interrupted.id,
      state: "failed",
      stateRevision: 5,
    });
  });
});
