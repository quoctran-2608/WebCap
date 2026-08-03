import { describe, expect, it, vi } from "vitest";

import { FullPageCaptureCoordinator } from "@background/full-page-capture-coordinator";
import type { JobCleanupReport, PersistentJobCoordinatorPort } from "@background/job-coordinator";
import { transitionJob, updateJob, type JobTransitionPatch } from "@background/job-state-machine";
import type { PagePreparationService } from "@background/page-preparation-service";
import type { CaptureEngine } from "@capture/capture-engine";
import type { CaptureJob, CaptureTile, JobState, PageMetrics } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { TileRepositoryPort } from "@storage/tile-repository";

const NOW = "2026-08-03T06:00:00.000Z";
const metrics: PageMetrics = {
  document: { x: 0, y: 0, width: 800, height: 1_200 },
  layoutViewport: { x: 0, y: 0, width: 800, height: 600 },
  visualViewport: { x: 0, y: 0, width: 800, height: 600, scale: 1 },
  devicePixelRatio: 1,
  zoomFactor: 1,
  scrollX: 0,
  scrollY: 0,
};

function tile(index: number, engine: "cdp" | "scroll"): CaptureTile {
  return {
    id: `job-fallback:${index}`,
    jobId: "job-fallback",
    index,
    row: index,
    column: 0,
    sourceRectCss: { x: 0, y: index * 600, width: 800, height: 600 },
    ...(engine === "scroll"
      ? {
          outputRectCss: { x: 0, y: index * 600, width: 800, height: 600 },
          scrollXCss: 0,
          scrollYCss: index * 600,
          overlapRightCss: 0,
          overlapBottomCss: 0,
        }
      : {}),
    expectedPixelWidth: 800,
    expectedPixelHeight: 600,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    status: "planned",
    attempts: 0,
  };
}

function stored(value: CaptureTile): CaptureTile {
  return {
    ...value,
    status: "stored",
    attempts: 1,
    byteLength: 3,
    mimeType: "image/png",
  };
}

class MemoryJobs implements PersistentJobCoordinatorPort {
  job: CaptureJob = {
    schemaVersion: 1,
    id: "job-fallback",
    tabId: 7,
    windowId: 2,
    source: { createdAt: NOW },
    mode: "full-page",
    preferredEngine: "cdp",
    state: "created",
    stateRevision: 0,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: "2026-08-03T06:30:00.000Z",
  };

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
    if (jobId !== this.job.id) {
      return Promise.reject(new Error("missing job"));
    }
    const result = updateJob(this.job, NOW, patch);
    if (!result.ok) {
      return Promise.reject(createWebCapRuntimeError(result.error));
    }
    this.job = result.value;
    return Promise.resolve(structuredClone(this.job));
  }

  transition(
    jobId: string,
    nextState: JobState,
    patch: JobTransitionPatch = {},
  ): Promise<CaptureJob> {
    if (jobId !== this.job.id) {
      return Promise.reject(new Error("missing job"));
    }
    const result = transitionJob(this.job, nextState, NOW, patch);
    if (!result.ok) {
      return Promise.reject(createWebCapRuntimeError(result.error));
    }
    this.job = result.value;
    return Promise.resolve(structuredClone(this.job));
  }

  cancel(): Promise<CaptureJob> {
    return Promise.resolve(structuredClone(this.job));
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

class MemoryTiles implements TileRepositoryPort {
  records: StoredTileRecord[] = [];
  deleted = 0;

  put(record: StoredTileRecord): Promise<void> {
    this.records = this.records.filter(
      (candidate) => candidate.jobId !== record.jobId || candidate.index !== record.index,
    );
    this.records.push(record);
    return Promise.resolve();
  }

  get(jobId: string, index: number): Promise<StoredTileRecord | undefined> {
    return Promise.resolve(
      this.records.find((record) => record.jobId === jobId && record.index === index),
    );
  }

  listByJob(jobId: string): Promise<StoredTileRecord[]> {
    return Promise.resolve(this.records.filter((record) => record.jobId === jobId));
  }

  deleteByJob(jobId: string): Promise<number> {
    const before = this.records.length;
    this.records = this.records.filter((record) => record.jobId !== jobId);
    this.deleted += before - this.records.length;
    return Promise.resolve(before - this.records.length);
  }
}

describe("FullPageCaptureCoordinator fallback", () => {
  it("deletes partial CDP tiles and reaches ready with a fresh scroll plan", async () => {
    const jobs = new MemoryJobs();
    const tiles = new MemoryTiles();
    const restore = vi.fn(() =>
      Promise.resolve({ preparationId: "job-fallback", completed: true }),
    );
    const pages = {
      prepare: vi.fn(() =>
        Promise.resolve({
          preparationId: "job-fallback",
          snapshotVersion: 1,
          originalScroll: { x: 0, y: 200 },
          preparedScroll: { x: 0, y: 0 },
          documentWidth: 800,
          documentHeight: 1_200,
          reachedLimit: false,
          stableSamples: 2,
          mutationCount: 0,
          modifiedNodeCount: 0,
        }),
      ),
      restore,
      cancel: vi.fn(() => Promise.resolve(true)),
    } as unknown as PagePreparationService;

    const cdpTile = tile(0, "cdp");
    const primary: CaptureEngine = {
      kind: "cdp",
      async capture(context) {
        await context.onPlan(metrics, metrics.document, [cdpTile]);
        await context.storeTile(stored(cdpTile), new Blob([new Uint8Array([9, 9, 9])]));
        throw createWebCapRuntimeError(
          createWebCapError({
            code: "E_CDP_COMMAND",
            stage: "capture",
            message: "CDP failed after the first tile.",
            userMessageKey: "errors.cdp.captureTile",
            retryable: true,
            fallbackAllowed: true,
          }),
        );
      },
    };
    const scrollTiles = [tile(0, "scroll"), tile(1, "scroll")];
    const cleanup = vi.fn(() => Promise.resolve());
    const fallback: CaptureEngine = {
      kind: "scroll",
      cleanup,
      async capture(context) {
        expect(context.preparation?.preparedScroll).toEqual({ x: 0, y: 0 });
        expect(context.windowId).toBe(2);
        await context.onPlan(metrics, metrics.document, scrollTiles);
        for (const planned of scrollTiles) {
          await context.storeTile(
            stored(planned),
            new Blob([new Uint8Array([1, 2, planned.index])], { type: "image/png" }),
          );
        }
        return { metrics, targetRect: metrics.document, tiles: scrollTiles.map(stored) };
      },
    };

    const coordinator = new FullPageCaptureCoordinator({
      jobs,
      pages,
      tiles,
      engine: primary,
      fallbackEngine: fallback,
      now: () => new Date(NOW),
    });

    await coordinator.start("job-fallback");

    expect(jobs.job).toMatchObject({
      state: "ready",
      activeEngine: "scroll",
      completedTiles: 2,
      totalTiles: 2,
      cleanup: { attempted: true, completed: true },
    });
    expect(jobs.job.tilePlan.map((value) => value.status)).toEqual(["stored", "stored"]);
    expect(tiles.deleted).toBe(1);
    expect(tiles.records.map((record) => record.index)).toEqual([0, 1]);
    expect(tiles.records.every((record) => record.tile.outputRectCss !== undefined)).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("does not fallback when the primary error forbids it", async () => {
    const jobs = new MemoryJobs();
    const tiles = new MemoryTiles();
    const fallback = { kind: "scroll", capture: vi.fn() } as unknown as CaptureEngine;
    const primary: CaptureEngine = {
      kind: "cdp",
      capture: () =>
        Promise.reject(
          createWebCapRuntimeError(
            createWebCapError({
              code: "E_CDP_COMMAND",
              stage: "capture",
              message: "Permanent CDP failure.",
              userMessageKey: "errors.cdp.command",
              retryable: false,
              fallbackAllowed: false,
            }),
          ),
        ),
    };
    const pages = {
      prepare: vi.fn(() => Promise.resolve({ preparationId: "job-fallback" })),
      restore: vi.fn(() => Promise.resolve({ completed: true })),
    } as unknown as PagePreparationService;
    const coordinator = new FullPageCaptureCoordinator({
      jobs,
      pages,
      tiles,
      engine: primary,
      fallbackEngine: fallback,
      now: () => new Date(NOW),
    });

    await coordinator.start("job-fallback");

    expect(jobs.job.state).toBe("failed");
    expect(jobs.job.error?.code).toBe("E_CDP_COMMAND");
    expect(fallback.capture).not.toHaveBeenCalled();
  });
});
