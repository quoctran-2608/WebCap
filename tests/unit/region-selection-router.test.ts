import { describe, expect, it, vi } from "vitest";

import {
  routePersistentJobMessage,
  routeRegionSelectionMessage,
  type PersistentJobRouterDependencies,
} from "@background/persistent-job-router";
import type { JobCleanupReport, PersistentJobCoordinatorPort } from "@background/job-coordinator";
import type { CaptureJob } from "@shared/contracts/domain";
import type { StoredDedupeRecord } from "@shared/contracts/job";
import { createJobGetActiveMessage } from "@shared/contracts/job-messages";
import {
  createRegionSelectionCancelMessage,
  createRegionSelectionCommitMessage,
} from "@shared/contracts/region-selection";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { DedupeRepositoryPort } from "@storage/dedupe-repository";

const now = new Date("2026-08-03T08:00:00.000Z");

function regionJob(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "region-job",
    tabId: 7,
    windowId: 2,
    source: { createdAt: now.toISOString() },
    mode: "region",
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
    expiresAt: "2026-08-03T08:30:00.000Z",
  };
}

class MemoryDedupe implements DedupeRepositoryPort {
  readonly values = new Map<string, StoredDedupeRecord>();

  get(requestId: string): Promise<StoredDedupeRecord | undefined> {
    return Promise.resolve(this.values.get(requestId));
  }

  put(record: StoredDedupeRecord): Promise<void> {
    this.values.set(record.requestId, record);
    return Promise.resolve();
  }

  deleteExpired(): Promise<number> {
    return Promise.resolve(0);
  }
}

class RegionJobs implements PersistentJobCoordinatorPort {
  current: CaptureJob | undefined = regionJob();
  readonly updateCall = vi.fn();
  readonly cancelCall = vi.fn();

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  create(): Promise<CaptureJob> {
    return Promise.resolve(regionJob());
  }

  get(): Promise<CaptureJob | undefined> {
    return Promise.resolve(this.current);
  }

  getActiveForTab(tabId: number): Promise<CaptureJob | undefined> {
    return Promise.resolve(this.current?.tabId === tabId ? this.current : undefined);
  }

  update(_jobId: string, patch: Partial<CaptureJob>): Promise<CaptureJob> {
    this.updateCall(patch);
    this.current = { ...(this.current ?? regionJob()), ...patch, stateRevision: 1 };
    return Promise.resolve(this.current);
  }

  transition(): Promise<CaptureJob> {
    return Promise.resolve(this.current ?? regionJob());
  }

  cancel(jobId: string, reason?: string): Promise<CaptureJob> {
    this.cancelCall(jobId, reason);
    const cancelled: CaptureJob = {
      ...(this.current ?? regionJob()),
      state: "cancelled",
      stateRevision: 2,
      cleanup: { attempted: true, completed: true },
      error: {
        code: "E_CANCELLED",
        stage: "cleanup",
        message: "cancelled",
        userMessageKey: "errors.cancelled",
        retryable: true,
        fallbackAllowed: false,
      },
    };
    this.current = cancelled;
    return Promise.resolve(cancelled);
  }

  cleanupExpired(): Promise<JobCleanupReport> {
    return Promise.resolve({
      deletedJobs: 0,
      skippedLeasedJobs: 0,
      failedJobs: 0,
      deletedTiles: 0,
      deletedArtifacts: 0,
      deletedManifests: 0,
      clearedSessions: 0,
    });
  }
}

function dependencies(jobs: RegionJobs, start = vi.fn(() => Promise.resolve())) {
  const captures = {
    start,
    cancel: vi.fn(() => Promise.resolve(regionJob())),
  };
  const value: PersistentJobRouterDependencies = {
    jobs,
    captures,
    dedupe: new MemoryDedupe(),
    now: () => now,
  };
  return { value, start };
}

const sender = {
  id: "extension-id",
  tab: { id: 7 },
} as chrome.runtime.MessageSender;

describe("region selection routing", () => {
  it("stores the document rect and starts the existing tiled coordinator", async () => {
    const jobs = new RegionJobs();
    const current = dependencies(jobs);
    const rect = { x: 120, y: 700, width: 640, height: 1_200 };
    const response = await routeRegionSelectionMessage(
      createRegionSelectionCommitMessage({
        requestId: "commit-1",
        jobId: "region-job",
        rect,
        sentAt: now.toISOString(),
      }),
      sender,
      current.value,
    );

    expect(response).toMatchObject({
      type: "REGION_SELECTION_EVENT_ACK",
      payload: { jobId: "region-job", accepted: true },
    });
    expect(jobs.updateCall).toHaveBeenCalledWith({ targetRect: rect });
    expect(current.start).toHaveBeenCalledWith("region-job");
  });

  it("cancels a created region job from the overlay", async () => {
    const jobs = new RegionJobs();
    const current = dependencies(jobs);
    const response = await routeRegionSelectionMessage(
      createRegionSelectionCancelMessage({
        requestId: "cancel-1",
        jobId: "region-job",
        reason: "keyboard cancellation",
        sentAt: now.toISOString(),
      }),
      sender,
      current.value,
    );

    expect(response).toMatchObject({ type: "REGION_SELECTION_EVENT_ACK" });
    expect(jobs.cancelCall).toHaveBeenCalledWith("region-job", "keyboard cancellation");
    expect(current.start).not.toHaveBeenCalled();
  });

  it("returns the active job for popup recovery without tile payloads", async () => {
    const jobs = new RegionJobs();
    const current = dependencies(jobs);
    const response = await routePersistentJobMessage(
      createJobGetActiveMessage({
        requestId: "active-1",
        tabId: 7,
        sentAt: now.toISOString(),
      }),
      current.value,
    );

    expect(response).toMatchObject({
      type: "JOB_ACTIVE_RESPONSE",
      payload: { job: { id: "region-job", mode: "region" } },
    });
    expect(JSON.stringify(response)).not.toContain("blob");
  });

  it("rejects events from another tab", async () => {
    const jobs = new RegionJobs();
    const current = dependencies(jobs);
    const response = await routeRegionSelectionMessage(
      createRegionSelectionCommitMessage({
        requestId: "commit-other-tab",
        jobId: "region-job",
        rect: { x: 1, y: 1, width: 20, height: 20 },
        sentAt: now.toISOString(),
      }),
      { ...sender, tab: { id: 9 } } as chrome.runtime.MessageSender,
      current.value,
    );

    expect(response).toMatchObject({
      type: "ERROR_RESPONSE",
      payload: { code: "E_PROTOCOL_MESSAGE", causeCode: "RegionSelectionJobMismatch" },
    });
    expect(current.start).not.toHaveBeenCalled();
  });
});
