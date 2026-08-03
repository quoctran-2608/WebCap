import { describe, expect, it, vi } from "vitest";

import { FullPageCaptureCoordinator } from "@background/full-page-capture-coordinator";
import type { JobCleanupReport, PersistentJobCoordinatorPort } from "@background/job-coordinator";
import { transitionJob, updateJob, type JobTransitionPatch } from "@background/job-state-machine";
import type { PagePreparationService } from "@background/page-preparation-service";
import type { CaptureEngine, CaptureEngineContext } from "@capture/capture-engine";
import type { CaptureJob, CaptureTile, JobState, PageMetrics } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { TileRepositoryPort } from "@storage/tile-repository";

const NOW = "2026-08-03T09:00:00.000Z";
const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "selection-1",
  tagName: "article",
  id: "target-card",
  classNames: ["card"],
  scrollable: false,
  captureKind: "visible-bounds" as const,
};

function initialJob(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "element-job",
    tabId: 7,
    windowId: 2,
    source: { createdAt: NOW },
    mode: "element",
    preferredEngine: "cdp",
    state: "created",
    stateRevision: 0,
    targetRect: { x: 40, y: 60, width: 300, height: 140 },
    targetDescriptor: descriptor,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: "2026-08-03T09:30:00.000Z",
  };
}

class Jobs implements PersistentJobCoordinatorPort {
  job = initialJob();
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  create(): Promise<CaptureJob> {
    return Promise.resolve(structuredClone(this.job));
  }
  get(jobId: string): Promise<CaptureJob | undefined> {
    return Promise.resolve(jobId === this.job.id ? structuredClone(this.job) : undefined);
  }
  update(jobId: string, patch: JobTransitionPatch): Promise<CaptureJob> {
    if (jobId !== this.job.id) return Promise.reject(new Error("missing job"));
    const result = updateJob(this.job, NOW, patch);
    if (!result.ok) return Promise.reject(createWebCapRuntimeError(result.error));
    this.job = result.value;
    return Promise.resolve(structuredClone(this.job));
  }
  transition(jobId: string, state: JobState, patch: JobTransitionPatch = {}): Promise<CaptureJob> {
    if (jobId !== this.job.id) return Promise.reject(new Error("missing job"));
    const result = transitionJob(this.job, state, NOW, patch);
    if (!result.ok) return Promise.reject(createWebCapRuntimeError(result.error));
    this.job = result.value;
    return Promise.resolve(structuredClone(this.job));
  }
  cancel(): Promise<CaptureJob> {
    return Promise.resolve(this.job);
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

class Tiles implements TileRepositoryPort {
  readonly records: StoredTileRecord[] = [];
  put(record: StoredTileRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
  get(): Promise<StoredTileRecord | undefined> {
    return Promise.resolve(undefined);
  }
  listByJob(): Promise<StoredTileRecord[]> {
    return Promise.resolve(this.records);
  }
  deleteByJob(): Promise<number> {
    return Promise.resolve(0);
  }
}

const metrics: PageMetrics = {
  document: { x: 0, y: 0, width: 1_000, height: 1_000 },
  layoutViewport: { x: 0, y: 0, width: 800, height: 600 },
  visualViewport: { x: 0, y: 0, width: 800, height: 600, scale: 1 },
  devicePixelRatio: 1,
  zoomFactor: 1,
  scrollX: 0,
  scrollY: 0,
};

function pageService() {
  return {
    prepare: vi.fn(() => Promise.resolve({ preparationId: "element-job" })),
    restore: vi.fn(() => Promise.resolve({ preparationId: "element-job", completed: true })),
    cancel: vi.fn(() => Promise.resolve(true)),
  } as unknown as PagePreparationService;
}

function tile(rect: { x: number; y: number; width: number; height: number }): CaptureTile {
  return {
    id: "element-job:0",
    jobId: "element-job",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: rect,
    expectedPixelWidth: Math.round(rect.width),
    expectedPixelHeight: Math.round(rect.height),
    overlapTopCss: 0,
    overlapLeftCss: 0,
    status: "planned",
    attempts: 0,
  };
}

describe("element target capture coordination", () => {
  it("fails with E_TARGET_STALE before the engine can capture another node", async () => {
    const jobs = new Jobs();
    const tiles = new Tiles();
    const pages = pageService();
    const capture = vi.fn<CaptureEngine["capture"]>();
    const coordinator = new FullPageCaptureCoordinator({
      jobs,
      pages,
      tiles,
      engine: { kind: "cdp", capture },
      targetValidator: {
        revalidate: () =>
          Promise.reject(
            createWebCapRuntimeError(
              createWebCapError({
                code: "E_TARGET_STALE",
                stage: "capture",
                message: "target disappeared",
                userMessageKey: "errors.targetStale",
                retryable: true,
                causeCode: "ElementTargetDisconnected",
              }),
            ),
          ),
      },
    });

    await coordinator.start("element-job");

    expect(capture).not.toHaveBeenCalled();
    expect(tiles.records).toEqual([]);
    expect(jobs.job.state).toBe("failed");
    expect(jobs.job.error).toMatchObject({
      code: "E_TARGET_STALE",
      causeCode: "ElementTargetDisconnected",
    });
    expect(jobs.job.cleanup).toEqual({ attempted: true, completed: true });
    expect(pages.restore).toHaveBeenCalledOnce();
  });

  it("updates moved bounds before planning and again before the engine attempt", async () => {
    const jobs = new Jobs();
    const tiles = new Tiles();
    const pages = pageService();
    const revalidate = vi
      .fn()
      .mockResolvedValueOnce({ x: 80, y: 100, width: 320, height: 160 })
      .mockResolvedValueOnce({ x: 90, y: 110, width: 330, height: 170 });
    const engine: CaptureEngine = {
      kind: "cdp",
      async capture(context: CaptureEngineContext) {
        const target = context.targetRect as { x: number; y: number; width: number; height: number };
        const planned = tile(target);
        await context.onPlan(metrics, target, [planned]);
        await context.storeTile(
          { ...planned, status: "stored", attempts: 1, byteLength: 3, mimeType: "image/png" },
          new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        );
        return { metrics, targetRect: target, tiles: [planned] };
      },
    };
    const coordinator = new FullPageCaptureCoordinator({
      jobs,
      pages,
      tiles,
      engine,
      targetValidator: { revalidate },
    });

    await coordinator.start("element-job");

    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(jobs.job.targetRect).toEqual({ x: 90, y: 110, width: 330, height: 170 });
    expect(jobs.job.tilePlan[0]?.sourceRectCss).toEqual(jobs.job.targetRect);
    expect(jobs.job.state).toBe("ready");
  });
});
