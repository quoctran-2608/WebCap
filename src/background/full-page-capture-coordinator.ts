import type { PagePreparationService } from "@background/page-preparation-service";
import type {
  CaptureCancellation,
  CaptureEngine,
  CaptureProgress,
} from "@capture/capture-engine";
import { JOB_PROGRESS_THROTTLE_MS, TILE_RECORD_SCHEMA_VERSION } from "@shared/constants";
import type { CaptureJob, CaptureTile } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import { createJobProgressMessage } from "@shared/contracts/job-progress";
import {
  WebCapRuntimeError,
  createWebCapError,
  createWebCapRuntimeError,
  type ErrorStage,
  type WebCapErrorData,
} from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import type { TileRepositoryPort } from "@storage/tile-repository";

import type { PersistentJobCoordinatorPort } from "./job-coordinator";
import { isTerminalJobState } from "./job-state-machine";

export interface JobProgressPublisher {
  publish(progress: CaptureProgress): Promise<void> | void;
}

export interface FullPageCaptureCoordinatorOptions {
  jobs: PersistentJobCoordinatorPort;
  pages: PagePreparationService;
  engine: CaptureEngine;
  tiles: TileRepositoryPort;
  progress?: JobProgressPublisher;
  now?: () => Date;
  requestId?: () => string;
}

interface ActiveCaptureRun {
  cancellation: MutableCaptureCancellation;
  promise: Promise<void>;
}

class MutableCaptureCancellation implements CaptureCancellation {
  cancelled = false;
  private reason: string | undefined;

  cancel(reason?: string): void {
    this.cancelled = true;
    this.reason = reason;
  }

  throwIfCancelled(stage: ErrorStage = "capture"): void {
    if (!this.cancelled) {
      return;
    }
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_CANCELLED",
        stage,
        message: "The full-page capture was cancelled.",
        userMessageKey: "errors.cancelled",
        retryable: true,
        fallbackAllowed: false,
        causeCode: "UserCancellation",
        ...(this.reason === undefined
          ? {}
          : { safeContext: { reason: this.reason.slice(0, 200) } }),
      }),
    );
  }
}

class ChromeRuntimeJobProgressPublisher implements JobProgressPublisher {
  constructor(
    private readonly now: () => Date,
    private readonly requestId: () => string,
  ) {}

  async publish(progress: CaptureProgress): Promise<void> {
    try {
      await chrome.runtime.sendMessage(
        createJobProgressMessage({
          requestId: this.requestId(),
          jobId: progress.jobId,
          state: progress.state,
          stage: progress.stage,
          completed: progress.completed,
          total: progress.total,
          ...(progress.tileIndex === undefined ? {} : { tileIndex: progress.tileIndex }),
          sentAt: this.now().toISOString(),
        }),
      );
    } catch {
      // The persistent job record remains authoritative when no popup is listening.
    }
  }
}

function missingJobError(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The full-page capture job does not exist.",
      userMessageKey: "errors.jobNotFound",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "JobNotFound",
      safeContext: { jobId },
    }),
  );
}

function invalidModeError(job: CaptureJob): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "Only full-page jobs can use the CDP full-page coordinator.",
      userMessageKey: "errors.captureMode",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "InvalidCaptureMode",
      safeContext: { jobId: job.id, mode: job.mode },
    }),
  );
}

function normalizedOperationError(error: unknown): WebCapErrorData {
  if (error instanceof WebCapRuntimeError) {
    return error.data;
  }
  return normalizeError(error, {
    code: "E_CDP_COMMAND",
    stage: "capture",
    userMessageKey: "errors.fullPageCapture",
    retryable: true,
    fallbackAllowed: true,
  });
}

function cleanupState(error: unknown): CaptureJob["cleanup"] {
  if (error === undefined) {
    return { attempted: true, completed: true };
  }
  const normalized =
    error instanceof WebCapRuntimeError
      ? error.data
      : normalizeError(error, {
          code: "E_CLEANUP_PARTIAL",
          stage: "cleanup",
          userMessageKey: "errors.cleanupPartial",
          retryable: true,
          fallbackAllowed: false,
        });
  return { attempted: true, completed: false, error: normalized };
}

export class FullPageCaptureCoordinator {
  private readonly jobs: PersistentJobCoordinatorPort;
  private readonly pages: PagePreparationService;
  private readonly engine: CaptureEngine;
  private readonly tiles: TileRepositoryPort;
  private readonly progress: JobProgressPublisher;
  private readonly now: () => Date;
  private readonly active = new Map<string, ActiveCaptureRun>();
  private readonly lastProgressAt = new Map<string, number>();

  constructor(options: FullPageCaptureCoordinatorOptions) {
    this.jobs = options.jobs;
    this.pages = options.pages;
    this.engine = options.engine;
    this.tiles = options.tiles;
    this.now = options.now ?? (() => new Date());
    const requestId = options.requestId ?? (() => crypto.randomUUID());
    this.progress =
      options.progress ?? new ChromeRuntimeJobProgressPublisher(this.now, requestId);
  }

  start(jobId: string): Promise<void> {
    const current = this.active.get(jobId);
    if (current !== undefined) {
      return current.promise;
    }

    const cancellation = new MutableCaptureCancellation();
    const promise = this.run(jobId, cancellation).finally(() => {
      this.active.delete(jobId);
      this.lastProgressAt.delete(jobId);
    });
    this.active.set(jobId, { cancellation, promise });
    return promise;
  }

  async cancel(jobId: string, reason?: string): Promise<CaptureJob> {
    const run = this.active.get(jobId);
    if (run === undefined) {
      return this.jobs.cancel(jobId, reason);
    }
    run.cancellation.cancel(reason);
    const job = await this.jobs.get(jobId);
    if (job === undefined) {
      throw missingJobError(jobId);
    }
    return job;
  }

  isRunning(jobId: string): boolean {
    return this.active.has(jobId);
  }

  private async run(jobId: string, cancellation: MutableCaptureCancellation): Promise<void> {
    let job = await this.jobs.get(jobId);
    if (job === undefined) {
      throw missingJobError(jobId);
    }
    if (job.mode !== "full-page") {
      throw invalidModeError(job);
    }
    if (job.state !== "created") {
      return;
    }

    job = await this.jobs.transition(job.id, "preparing");
    await this.publish({
      jobId: job.id,
      state: job.state,
      stage: "preparing",
      completed: 0,
      total: 0,
    });

    let prepared = false;
    let operationError: unknown;
    let restoreError: unknown;

    try {
      await this.pages.prepare({
        tabId: job.tabId,
        preparationId: job.id,
        options: {
          maxCssHeight: job.settings.limits.maxCssHeight,
          lazyLoad: job.settings.lazyLoad,
        },
      });
      prepared = true;
      cancellation.throwIfCancelled("prepare");
      await this.engine.capture({
        jobId: job.id,
        tabId: job.tabId,
        settings: job.settings,
        cancellation,
        onPlan: async (metrics, targetRect, tiles) => {
          await this.jobs.transition(job.id, "capturing", {
            activeEngine: this.engine.kind,
            metrics,
            targetRect,
            tilePlan: tiles,
            completedTiles: 0,
            totalTiles: tiles.length,
          });
        },
        storeTile: (tile, blob) => this.storeTile(job.id, tile, blob),
        reportProgress: (progress) => this.publish(progress),
      });
    } catch (error) {
      operationError = error;
    }

    if (prepared) {
      await this.publish({
        jobId: job.id,
        state: (await this.jobs.get(job.id))?.state ?? "preparing",
        stage: "restoring",
        completed: (await this.jobs.get(job.id))?.completedTiles ?? 0,
        total: (await this.jobs.get(job.id))?.totalTiles ?? 0,
      });
      try {
        await this.pages.restore(job.tabId, job.id);
      } catch (error) {
        restoreError = error;
      }
    }

    if (operationError !== undefined || restoreError !== undefined) {
      await this.settleFailure(job.id, cancellation, operationError, restoreError);
      return;
    }

    const cleanup = cleanupState(undefined);
    job = await this.requireJob(job.id);
    if (job.state !== "capturing") {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_PROTOCOL_MESSAGE",
          stage: "protocol",
          message: "The full-page job left the capturing state unexpectedly.",
          userMessageKey: "errors.jobState",
          retryable: true,
          fallbackAllowed: false,
          causeCode: "UnexpectedCaptureState",
          safeContext: { jobId: job.id, state: job.state },
        }),
      );
    }
    job = await this.jobs.transition(job.id, "processing", { cleanup });
    job = await this.jobs.transition(job.id, "ready", { cleanup });
    await this.publish({
      jobId: job.id,
      state: job.state,
      stage: "ready",
      completed: job.completedTiles,
      total: job.totalTiles,
    });
  }

  private async storeTile(jobId: string, tile: CaptureTile, blob: Blob): Promise<void> {
    const timestamp = this.now().toISOString();
    const record: StoredTileRecord = {
      schemaVersion: TILE_RECORD_SCHEMA_VERSION,
      jobId,
      index: tile.index,
      tile,
      blob,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.tiles.put(record);

    const job = await this.requireJob(jobId);
    const tilePlan = job.tilePlan.map((planned) =>
      planned.index === tile.index ? tile : planned,
    );
    const completedTiles = tilePlan.filter((planned) => planned.status === "stored").length;
    const updated = await this.jobs.update(jobId, { tilePlan, completedTiles });
    await this.publish({
      jobId,
      state: updated.state,
      stage: "storing",
      completed: updated.completedTiles,
      total: updated.totalTiles,
      tileIndex: tile.index,
    });
  }

  private async settleFailure(
    jobId: string,
    cancellation: MutableCaptureCancellation,
    operationError: unknown,
    restoreError: unknown,
  ): Promise<void> {
    const primary =
      operationError === undefined ? normalizedOperationError(restoreError) : normalizedOperationError(operationError);
    const cleanup = cleanupState(restoreError);
    let job = await this.requireJob(jobId);
    const cancelled = cancellation.cancelled || primary.code === "E_CANCELLED";

    if (cancelled) {
      if (job.state === "created") {
        job = await this.jobs.transition(job.id, "preparing");
      }
      if (job.state === "failed") {
        await this.jobs.transition(job.id, "cancelled", { cleanup, error: primary });
        return;
      }
      if (job.state !== "cancelling" && !isTerminalJobState(job.state)) {
        job = await this.jobs.transition(job.id, "cancelling");
      }
      if (job.state === "cancelling") {
        await this.jobs.transition(job.id, "cancelled", { cleanup, error: primary });
      }
      return;
    }

    if (isTerminalJobState(job.state)) {
      return;
    }
    if (job.state === "created") {
      job = await this.jobs.transition(job.id, "preparing");
    }
    if (job.state === "cancelling") {
      await this.jobs.transition(job.id, "cancelled", { cleanup, error: primary });
      return;
    }
    await this.jobs.transition(job.id, "failed", { cleanup, error: primary });
  }

  private async requireJob(jobId: string): Promise<CaptureJob> {
    const job = await this.jobs.get(jobId);
    if (job === undefined) {
      throw missingJobError(jobId);
    }
    return job;
  }

  private async publish(progress: CaptureProgress): Promise<void> {
    const now = this.now().getTime();
    const previous = this.lastProgressAt.get(progress.jobId) ?? 0;
    const finalUpdate = progress.completed === progress.total && progress.total > 0;
    if (!finalUpdate && now - previous < JOB_PROGRESS_THROTTLE_MS) {
      return;
    }
    this.lastProgressAt.set(progress.jobId, now);
    await this.progress.publish(progress);
  }
}
