import type { PagePreparationService } from "@background/page-preparation-service";
import type {
  CaptureCancellation,
  CaptureEngine,
  CaptureEngineContext,
  CaptureProgress,
} from "@capture/capture-engine";
import { rectCoveringTiles } from "@capture/partial-capture";
import { JOB_PROGRESS_THROTTLE_MS, TILE_RECORD_SCHEMA_VERSION } from "@shared/constants";
import type {
  AdaptiveCaptureFrontier,
  CaptureJob,
  CaptureTile,
  PageMetrics,
  PartialCapture,
  Rect,
} from "@shared/contracts/domain";
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

export interface AdaptiveJobProgressPublisher {
  publish(progress: CaptureProgress): Promise<void> | void;
}

export interface AdaptiveCaptureCoordinatorOptions {
  jobs: PersistentJobCoordinatorPort;
  pages: PagePreparationService;
  engine: CaptureEngine;
  tiles: TileRepositoryPort;
  progress?: AdaptiveJobProgressPublisher;
  now?: () => Date;
  requestId?: () => string;
}

interface ActiveCaptureRun {
  cancellation: MutableCaptureCancellation;
  promise: Promise<void>;
}

class MutableCaptureCancellation implements CaptureCancellation {
  cancelled = false;
  keepPartial = false;
  private reason: string | undefined;

  cancel(reason?: string, disposition: "discard" | "keep-partial" = "discard"): void {
    this.cancelled = true;
    this.keepPartial = disposition === "keep-partial";
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
        message: "The adaptive full-page capture was cancelled.",
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

class ChromeRuntimeProgressPublisher implements AdaptiveJobProgressPublisher {
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
      // Persistent job state remains authoritative when no popup is listening.
    }
  }
}

function missingJobError(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The adaptive capture job does not exist.",
      userMessageKey: "errors.jobNotFound",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "JobNotFound",
      safeContext: { jobId },
    }),
  );
}

function invalidJobError(job: CaptureJob): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "This job cannot use the adaptive full-page coordinator.",
      userMessageKey: "errors.captureMode",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "InvalidAdaptiveJob",
      safeContext: { jobId: job.id, mode: job.mode, state: job.state },
    }),
  );
}

function normalizedOperationError(error: unknown): WebCapErrorData {
  if (error instanceof WebCapRuntimeError) {
    return error.data;
  }
  return normalizeError(error, {
    code: "E_CAPTURE_EMPTY",
    stage: "capture",
    userMessageKey: "errors.fullPageCapture",
    retryable: true,
    fallbackAllowed: false,
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

function completeStoredRows(tiles: CaptureTile[]): CaptureTile[] {
  const byRow = new Map<number, CaptureTile[]>();
  for (const tile of tiles) {
    const row = byRow.get(tile.row) ?? [];
    row.push(tile);
    byRow.set(tile.row, row);
  }
  const selected: CaptureTile[] = [];
  for (let rowIndex = 0; ; rowIndex += 1) {
    const row = byRow.get(rowIndex);
    if (row === undefined || row.length === 0 || row.some((tile) => tile.status !== "stored")) {
      break;
    }
    selected.push(...row.sort((left, right) => left.column - right.column));
  }
  return selected;
}

export class AdaptiveCaptureCoordinator {
  private readonly jobs: PersistentJobCoordinatorPort;
  private readonly pages: PagePreparationService;
  private readonly engine: CaptureEngine;
  private readonly tiles: TileRepositoryPort;
  private readonly progress: AdaptiveJobProgressPublisher;
  private readonly now: () => Date;
  private readonly active = new Map<string, ActiveCaptureRun>();
  private readonly lastProgressAt = new Map<string, number>();

  constructor(options: AdaptiveCaptureCoordinatorOptions) {
    if (options.engine.adaptive !== true) {
      throw new TypeError("AdaptiveCaptureCoordinator requires an adaptive capture engine.");
    }
    this.jobs = options.jobs;
    this.pages = options.pages;
    this.engine = options.engine;
    this.tiles = options.tiles;
    this.now = options.now ?? (() => new Date());
    const requestId = options.requestId ?? (() => crypto.randomUUID());
    this.progress = options.progress ?? new ChromeRuntimeProgressPublisher(this.now, requestId);
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

  async cancel(
    jobId: string,
    reason?: string,
    disposition: "discard" | "keep-partial" = "discard",
  ): Promise<CaptureJob> {
    const run = this.active.get(jobId);
    if (run === undefined) {
      return this.jobs.cancel(jobId, reason);
    }
    run.cancellation.cancel(reason, disposition);
    const job = await this.requireJob(jobId);
    if (job.state === "preparing") {
      try {
        await this.pages.cancel(job.tabId, job.id);
      } catch {
        // The in-memory cancellation token is authoritative at the next checkpoint.
      }
    }
    return job;
  }

  async waitForIdle(jobId: string): Promise<void> {
    const run = this.active.get(jobId);
    if (run !== undefined) {
      await run.promise.catch(() => undefined);
    }
  }

  isRunning(jobId: string): boolean {
    return this.active.has(jobId);
  }

  private async run(jobId: string, cancellation: MutableCaptureCancellation): Promise<void> {
    let job = await this.requireJob(jobId);
    if (job.mode !== "full-page" || !["created", "preparing", "capturing"].includes(job.state)) {
      if (isTerminalJobState(job.state) || job.state === "ready") {
        return;
      }
      throw invalidJobError(job);
    }
    if (job.state === "created") {
      job = await this.jobs.transition(job.id, "preparing");
    }
    await this.publish({
      jobId: job.id,
      state: job.state,
      stage: "preparing",
      completed: job.completedTiles,
      total: job.totalTiles,
    });

    let operationError: unknown;
    let restoreError: unknown;
    let context: CaptureEngineContext | undefined;
    let prepared = false;

    try {
      const preparation = await this.pages.prepare({
        tabId: job.tabId,
        preparationId: job.id,
        options: {
          targetStartX: 0,
          targetStartY: 0,
          maxCssHeight: job.settings.limits.maxCssHeight,
          lazyLoad: {
            ...job.settings.lazyLoad,
            enabled: false,
          },
        },
      });
      prepared = true;
      cancellation.throwIfCancelled("prepare");
      job = await this.requireJob(job.id);
      context = {
        jobId: job.id,
        tabId: job.tabId,
        windowId: job.windowId,
        mode: job.mode,
        settings: job.settings,
        preparation,
        ...(job.adaptiveFrontier === undefined
          ? {}
          : {
              resume: {
                frontier: job.adaptiveFrontier,
                tilePlan: job.tilePlan,
                ...(job.metrics === undefined ? {} : { metrics: job.metrics }),
              },
            }),
        cancellation,
        onPlan: (metrics, targetRect, tiles, partialCapture) =>
          this.recordPlan(job.id, metrics, targetRect, tiles, partialCapture),
        checkpointFrontier: (frontier) => this.checkpointFrontier(job.id, frontier),
        discardTilesFromIndex: (firstIndex) => this.discardTilesFromIndex(job.id, firstIndex),
        storeTile: (tile, blob) => this.storeTile(job.id, tile, blob),
        reportProgress: (progress) => this.publish(progress),
      };
      await this.engine.capture(context);
      cancellation.throwIfCancelled("capture");
    } catch (error) {
      operationError = error;
    }

    if (context !== undefined && this.engine.cleanup !== undefined) {
      try {
        await this.engine.cleanup(context);
      } catch (error) {
        restoreError = error;
      }
    }
    if (prepared) {
      try {
        await this.pages.restore(job.tabId, job.id);
      } catch (error) {
        restoreError ??= error;
      }
    }

    if (operationError === undefined && restoreError === undefined) {
      try {
        cancellation.throwIfCancelled("cleanup");
      } catch (error) {
        operationError = error;
      }
    }

    if (operationError !== undefined || restoreError !== undefined) {
      if (
        restoreError === undefined &&
        cancellation.keepPartial &&
        normalizedOperationError(operationError).code === "E_CANCELLED" &&
        (await this.settlePartialStop(job.id))
      ) {
        return;
      }
      await this.settleFailure(job.id, cancellation, operationError, restoreError);
      return;
    }

    try {
      const cleanup = cleanupState(undefined);
      job = await this.requireJob(job.id);
      if (job.state !== "capturing") {
        throw invalidJobError(job);
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
    } catch (error) {
      await this.settleFailure(job.id, cancellation, error, undefined);
    }
  }

  private async recordPlan(
    jobId: string,
    metrics: PageMetrics,
    targetRect: Rect,
    tiles: CaptureTile[],
    partialCapture?: PartialCapture,
  ): Promise<void> {
    const job = await this.requireJob(jobId);
    const completedTiles = tiles.filter((tile) => tile.status === "stored").length;
    const patch = {
      activeEngine: this.engine.kind,
      metrics,
      targetRect,
      tilePlan: tiles,
      completedTiles,
      totalTiles: tiles.length,
      ...(partialCapture === undefined ? {} : { partialCapture }),
    };
    if (job.state === "preparing") {
      await this.jobs.transition(job.id, "capturing", patch);
      return;
    }
    if (job.state === "capturing") {
      await this.jobs.update(job.id, patch);
      return;
    }
    throw invalidJobError(job);
  }

  private async checkpointFrontier(
    jobId: string,
    adaptiveFrontier: AdaptiveCaptureFrontier,
  ): Promise<void> {
    const job = await this.requireJob(jobId);
    if (job.state !== "preparing" && job.state !== "capturing") {
      throw invalidJobError(job);
    }
    await this.jobs.update(jobId, { adaptiveFrontier });
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
    const tilePlan = job.tilePlan.map((planned) => (planned.index === tile.index ? tile : planned));
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

  private async discardTilesFromIndex(jobId: string, firstIndex: number): Promise<void> {
    const records = (await this.tiles.listByJob(jobId)).filter(
      (record) => record.index < firstIndex,
    );
    await this.tiles.deleteByJob(jobId);
    for (const record of records) {
      await this.tiles.put(record);
    }
    const job = await this.requireJob(jobId);
    const tilePlan = job.tilePlan.filter((tile) => tile.index < firstIndex);
    await this.jobs.update(jobId, {
      tilePlan,
      completedTiles: tilePlan.filter((tile) => tile.status === "stored").length,
      totalTiles: tilePlan.length,
    });
  }

  private async settlePartialStop(jobId: string): Promise<boolean> {
    let job = await this.requireJob(jobId);
    if (job.state !== "capturing" || job.completedTiles === 0) {
      return false;
    }
    const selectedTiles = completeStoredRows(job.tilePlan);
    const capturedRect = rectCoveringTiles(selectedTiles);
    if (selectedTiles.length === 0 || capturedRect === undefined) {
      return false;
    }

    const selectedIndexes = new Set(selectedTiles.map((tile) => tile.index));
    const records = (await this.tiles.listByJob(jobId)).filter((record) =>
      selectedIndexes.has(record.index),
    );
    await this.tiles.deleteByJob(jobId);
    for (const record of records) {
      await this.tiles.put(record);
    }

    const cleanup = cleanupState(undefined);
    job = await this.jobs.update(jobId, {
      targetRect: capturedRect,
      tilePlan: selectedTiles,
      completedTiles: selectedTiles.length,
      totalTiles: selectedTiles.length,
      cleanup,
      partialCapture: {
        reason: "user-stop",
        capturedRect,
        limitValue: selectedTiles.length,
      },
    });
    job = await this.jobs.transition(job.id, "processing", { cleanup });
    job = await this.jobs.transition(job.id, "ready", { cleanup });
    await this.publish({
      jobId: job.id,
      state: job.state,
      stage: "ready",
      completed: job.completedTiles,
      total: job.totalTiles,
    });
    return true;
  }

  private async settleFailure(
    jobId: string,
    cancellation: MutableCaptureCancellation,
    operationError: unknown,
    restoreError: unknown,
  ): Promise<void> {
    const primary =
      operationError === undefined
        ? normalizedOperationError(restoreError)
        : normalizedOperationError(operationError);
    const cleanup = cleanupState(restoreError);
    let job = await this.requireJob(jobId);
    const cancelled = cancellation.cancelled || primary.code === "E_CANCELLED";

    if (cancelled) {
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
    try {
      await this.progress.publish(progress);
    } catch {
      // Progress delivery is best-effort; persistent job state is authoritative.
    }
  }
}
