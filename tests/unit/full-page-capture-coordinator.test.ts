import { describe, expect, it, vi } from "vitest";

import {
  FullPageCaptureCoordinator,
  type JobProgressPublisher,
} from "@background/full-page-capture-coordinator";
import type { JobCleanupReport, PersistentJobCoordinatorPort } from "@background/job-coordinator";
import { transitionJob, updateJob, type JobTransitionPatch } from "@background/job-state-machine";
import type { PagePreparationService } from "@background/page-preparation-service";
import type { CaptureEngine, CaptureEngineContext } from "@capture/capture-engine";
import type { CaptureJob, CaptureTile, JobState, PageMetrics } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { TileRepositoryPort } from "@storage/tile-repository";

const NOW = "2026-08-03T04:00:00.000Z";

const metrics: PageMetrics = {
  document: { x: 0, y: 0, width: 900, height: 1_200 },
  layoutViewport: { x: 0, y: 0, width: 900, height: 600 },
  visualViewport: { x: 0, y: 0, width: 900, height: 600, scale: 1 },
  devicePixelRatio: 1,
  zoomFactor: 1,
  scrollX: 0,
  scrollY: 0,
};

function plannedTile(index: number): CaptureTile {
  return {
    id: `job-full:${index}`,
    jobId: "job-full",
    index,
    row: index,
    column: 0,
    sourceRectCss: { x: 0, y: index * 600, width: 900, height: 600 },
    expectedPixelWidth: 900,
    expectedPixelHeight: 600,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    status: "planned",
    attempts: 0,
  };
}

function initialJob(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-full",
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
    expiresAt: "2026-08-03T04:30:00.000Z",
  };
}

class MemoryJobCoordinator implements PersistentJobCoordinatorPort {
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

  async cancel(jobId: string): Promise<CaptureJob> {
    let job = await this.get(jobId);
    if (job === undefined) {
      throw new Error("missing job");
    }
    if (job.state === "created") {
      job = await this.transition(jobId, "preparing");
    }
    if (job.state === "failed") {
      return this.transition(jobId, "cancelled", {
        cleanup: { attempted: true, completed: true },
        error: createWebCapError({
          code: "E_CANCELLED",
          stage: "cleanup",
          message: "cancelled",
          userMessageKey: "errors.cancelled",
        }),
      });
    }
    if (job.state !== "cancelling") {
      job = await this.transition(jobId, "cancelling");
    }
    return this.transition(jobId, "cancelled", {
      cleanup: { attempted: true, completed: true },
      error: createWebCapError({
        code: "E_CANCELLED",
        stage: "cleanup",
        message: "cancelled",
        userMessageKey: "errors.cancelled",
      }),
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

class MemoryTiles implements TileRepositoryPort {
  readonly records: StoredTileRecord[] = [];

  put(record: StoredTileRecord): Promise<void> {
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
    const remaining = this.records.filter((record) => record.jobId !== jobId);
    this.records.splice(0, this.records.length, ...remaining);
    return Promise.resolve(before - remaining.length);
  }
}

interface PageHarnessOptions {
  restoreError?: Error;
  restore?: () => Promise<unknown>;
}

function pageHarness(options: PageHarnessOptions = {}) {
  const prepare = vi.fn(() => Promise.resolve({ preparationId: "job-full" }));
  const restore = vi.fn(() => {
    if (options.restore !== undefined) {
      return options.restore();
    }
    return options.restoreError === undefined
      ? Promise.resolve({ preparationId: "job-full", completed: true })
      : Promise.reject(options.restoreError);
  });
  const cancel = vi.fn(() => Promise.resolve(true));
  return {
    service: { prepare, restore, cancel } as unknown as PagePreparationService,
    prepare,
    restore,
    cancel,
  };
}

function stored(tile: CaptureTile): CaptureTile {
  return {
    ...tile,
    status: "stored",
    attempts: 1,
    byteLength: 3,
    mimeType: "image/png",
  };
}

function successfulEngine(): CaptureEngine {
  return {
    kind: "cdp",
    async capture(context: CaptureEngineContext) {
      const tiles = [plannedTile(0), plannedTile(1)];
      await context.onPlan(metrics, metrics.document, tiles);
      for (const tile of tiles) {
        await context.storeTile(
          stored(tile),
          new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        );
      }
      return { metrics, targetRect: metrics.document, tiles: tiles.map(stored) };
    },
  };
}

function setup(engine: CaptureEngine, page = pageHarness()) {
  const jobs = new MemoryJobCoordinator();
  const tiles = new MemoryTiles();
  const events: Parameters<JobProgressPublisher["publish"]>[0][] = [];
  const coordinator = new FullPageCaptureCoordinator({
    jobs,
    pages: page.service,
    engine,
    tiles,
    progress: {
      publish(progress) {
        events.push(progress);
      },
    },
    now: () => new Date(NOW),
  });
  return { coordinator, jobs, tiles, events, page };
}

describe("FullPageCaptureCoordinator", () => {
  it("runs prepare, captures and persists each tile, restores, then reaches ready", async () => {
    const { coordinator, jobs, tiles, events, page } = setup(successfulEngine());

    await coordinator.start("job-full");

    expect(jobs.job.state).toBe("ready");
    expect(jobs.job.completedTiles).toBe(2);
    expect(jobs.job.tilePlan.every((tile) => tile.status === "stored")).toBe(true);
    expect(jobs.job.cleanup).toEqual({ attempted: true, completed: true });
    expect(tiles.records).toHaveLength(2);
    expect(tiles.records.map((record) => record.index)).toEqual([0, 1]);
    expect(page.prepare).toHaveBeenCalledTimes(1);
    expect(page.restore).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ stage: "ready", completed: 2, total: 2 });
  });

  it("cancels between tiles and restores the page before settling cancelled", async () => {
    let releaseSecondTile!: () => void;
    let firstTileStored!: () => void;
    const firstStored = new Promise<void>((resolve) => {
      firstTileStored = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseSecondTile = resolve;
    });
    const engine: CaptureEngine = {
      kind: "cdp",
      async capture(context) {
        const tiles = [plannedTile(0), plannedTile(1)];
        await context.onPlan(metrics, metrics.document, tiles);
        await context.storeTile(stored(tiles[0] as CaptureTile), new Blob(["one"]));
        firstTileStored();
        await gate;
        context.cancellation.throwIfCancelled("capture");
        await context.storeTile(stored(tiles[1] as CaptureTile), new Blob(["two"]));
        return { metrics, targetRect: metrics.document, tiles: tiles.map(stored) };
      },
    };
    const { coordinator, jobs, tiles, page } = setup(engine);

    const running = coordinator.start("job-full");
    await firstStored;
    await coordinator.cancel("job-full", "test cancellation");
    releaseSecondTile();
    await running;

    expect(jobs.job.state).toBe("cancelled");
    expect(jobs.job.error?.code).toBe("E_CANCELLED");
    expect(jobs.job.cleanup).toEqual({ attempted: true, completed: true });
    expect(tiles.records).toHaveLength(1);
    expect(page.restore).toHaveBeenCalledTimes(1);
  });

  it("stops after a stored tile and keeps an exportable partial capture", async () => {
    let releaseCapture!: () => void;
    let signalStored!: () => void;
    const storedSignal = new Promise<void>((resolve) => {
      signalStored = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const engine: CaptureEngine = {
      kind: "cdp",
      async capture(context) {
        const tiles = [plannedTile(0), plannedTile(1), plannedTile(2)];
        await context.onPlan(metrics, { ...metrics.document, height: 1_800 }, tiles);
        await context.storeTile(stored(tiles[0] as CaptureTile), new Blob(["one"]));
        signalStored();
        await gate;
        context.cancellation.throwIfCancelled("capture");
        return { metrics, targetRect: metrics.document, tiles: [stored(tiles[0] as CaptureTile)] };
      },
    };
    const { coordinator, jobs, tiles } = setup(engine);

    const running = coordinator.start("job-full");
    await storedSignal;
    await coordinator.cancel("job-full", "keep captured prefix", "keep-partial");
    releaseCapture();
    await running;

    expect(jobs.job.state).toBe("ready");
    expect(jobs.job.partialCapture).toMatchObject({
      reason: "user-stop",
      limitValue: 1,
      capturedRect: { x: 0, y: 0, width: 900, height: 600 },
    });
    expect(jobs.job.completedTiles).toBe(1);
    expect(jobs.job.totalTiles).toBe(1);
    expect(tiles.records).toHaveLength(1);
  });

  it("lets cancellation win while page restoration is finishing", async () => {
    let releaseRestore!: () => void;
    let signalRestoreStarted!: () => void;
    const restoreStarted = new Promise<void>((resolve) => {
      signalRestoreStarted = resolve;
    });
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const page = pageHarness({
      async restore() {
        signalRestoreStarted();
        await restoreGate;
        return { preparationId: "job-full", completed: true };
      },
    });
    const { coordinator, jobs } = setup(successfulEngine(), page);

    const running = coordinator.start("job-full");
    await restoreStarted;
    await coordinator.cancel("job-full", "cancel during restore");
    releaseRestore();
    await running;

    expect(jobs.job.state).toBe("cancelled");
    expect(jobs.job.error?.code).toBe("E_CANCELLED");
    expect(jobs.job.cleanup).toEqual({ attempted: true, completed: true });
    expect(page.restore).toHaveBeenCalledTimes(1);
  });

  it("records debugger detach as a retryable fallback-eligible failure", async () => {
    const engine: CaptureEngine = {
      kind: "cdp",
      capture: () =>
        Promise.reject(
          createWebCapRuntimeError(
            createWebCapError({
              code: "E_DEBUGGER_DETACHED",
              stage: "capture",
              message: "detached",
              userMessageKey: "errors.debugger.detached",
              retryable: true,
              fallbackAllowed: true,
            }),
          ),
        ),
    };
    const { coordinator, jobs, page } = setup(engine);

    await coordinator.start("job-full");

    expect(jobs.job.state).toBe("failed");
    expect(jobs.job.error).toMatchObject({
      code: "E_DEBUGGER_DETACHED",
      retryable: true,
      fallbackAllowed: true,
    });
    expect(jobs.job.cleanup).toEqual({ attempted: true, completed: true });
    expect(page.restore).toHaveBeenCalledTimes(1);
  });

  it("preserves the capture error while recording a partial restore", async () => {
    const captureError = createWebCapRuntimeError(
      createWebCapError({
        code: "E_CDP_COMMAND",
        stage: "capture",
        message: "capture failed",
        userMessageKey: "errors.capture",
        retryable: true,
        fallbackAllowed: true,
      }),
    );
    const restoreError = createWebCapRuntimeError(
      createWebCapError({
        code: "E_CLEANUP_PARTIAL",
        stage: "cleanup",
        message: "restore failed",
        userMessageKey: "errors.cleanupPartial",
        retryable: true,
        fallbackAllowed: false,
      }),
    );
    const engine: CaptureEngine = {
      kind: "cdp",
      capture: () => Promise.reject(captureError),
    };
    const { coordinator, jobs } = setup(engine, pageHarness({ restoreError }));

    await coordinator.start("job-full");

    expect(jobs.job.state).toBe("failed");
    expect(jobs.job.error?.code).toBe("E_CDP_COMMAND");
    expect(jobs.job.cleanup).toMatchObject({
      attempted: true,
      completed: false,
      error: { code: "E_CLEANUP_PARTIAL" },
    });
  });
});
