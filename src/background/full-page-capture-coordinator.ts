import type { PagePreparationService } from "@background/page-preparation-service";
import type {
  CaptureCancellation,
  CaptureEngine,
  CaptureEngineContext,
  CaptureProgress,
} from "@capture/capture-engine";
import { JOB_PROGRESS_THROTTLE_MS, TILE_RECORD_SCHEMA_VERSION } from "@shared/constants";
import type {
  CaptureJob,
  CaptureTile,
  DocumentPageMap,
  PageMetrics,
  PartialCapture,
  Rect,
} from "@shared/contracts/domain";
import { contiguousStoredPrefix, rectCoveringTiles } from "@capture/partial-capture";
import type { ElementTargetValidationPort } from "@background/element-selection-service";
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
  pages?: PagePreparationService;
  preparePage?: boolean;
  engine: CaptureEngine;
  fallbackEngine?: CaptureEngine;
  tiles: TileRepositoryPort;
  targetValidator?: ElementTargetValidationPort;
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
      message: "This capture mode cannot use the tiled capture coordinator.",
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

function fallbackAllowed(error: unknown): boolean {
  return error instanceof WebCapRuntimeError && error.fallbackAllowed;
}

export class FullPageCaptureCoordinator {
  private readonly jobs: PersistentJobCoordinatorPort;
  private readonly pages: PagePreparationService | undefined;
  private readonly preparePage: boolean;
  private readonly engine: CaptureEngine;
  private readonly fallbackEngine: CaptureEngine | undefined;
  private readonly tiles: TileRepositoryPort;
  private readonly targetValidator: ElementTargetValidationPort | undefined;
  private readonly progress: JobProgressPublisher;
  private readonly now: () => Date;
  private readonly active = new Map<string, ActiveCaptureRun>();
  private readonly lastProgressAt = new Map<string, number>();

  constructor(options: FullPageCaptureCoordinatorOptions) {
    this.jobs = options.jobs;
    this.pages = options.pages;
    this.preparePage = options.preparePage ?? true;
    if (this.preparePage && this.pages === undefined) {
      throw new TypeError("Prepared capture coordinator requires a page preparation service.");
    }
    this.engine = options.engine;
    this.fallbackEngine = options.fallbackEngine;
    this.tiles = options.tiles;
    this.targetValidator = options.targetValidator;
    this.now = options.now ?? (() => new Date());
    const requestId = options.requestId ?? (() => crypto.randomUUID());
    this.progress = options.progress ?? new ChromeRuntimeJobProgressPublisher(this.now, requestId);
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
    if (job.state === "ready" || job.state === "failed") {
      return this.jobs.cancel(jobId, reason);
    }
    if (job.state === "preparing" && this.preparePage && this.pages !== undefined) {
      try {
        await this.pages.cancel(job.tabId, job.id);
      } catch {
        // The in-memory token still cancels at the next coordinator checkpoint.
      }
    }
    return job;
  }

  async waitForIdle(jobId: string): Promise<void> {
    const run = this.active.get(jobId);
    if (run === undefined) {
      return;
    }
    await run.promise.catch(() => undefined);
  }

  isRunning(jobId: string): boolean {
    return this.active.has(jobId);
  }

  private async revalidateTarget(job: CaptureJob): Promise<CaptureJob> {
    if (job.mode !== "element" && job.mode !== "scroll-area") {
      return job;
    }
    if (this.targetValidator === undefined || job.targetDescriptor === undefined) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_TARGET_STALE",
          stage: "capture",
          message: "The selected capture target is unavailable.",
          userMessageKey: "errors.targetStale",
          retryable: true,
          fallbackAllowed: false,
          causeCode: "CaptureTargetValidatorMissing",
          safeContext: { jobId: job.id },
        }),
      );
    }
    const targetRect = await this.targetValidator.revalidate(job);
    return this.jobs.update(job.id, { targetRect });
  }

  private async run(jobId: string, cancellation: MutableCaptureCancellation): Promise<void> {
    let job = await this.requireJob(jobId);
    if (
      job.mode !== "full-page" &&
      job.mode !== "region" &&
      job.mode !== "element" &&
      job.mode !== "scroll-area"
    ) {
      throw invalidModeError(job);
    }
    if (
      (job.mode === "region" || job.mode === "element" || job.mode === "scroll-area") &&
      job.targetRect === undefined
    ) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_PROTOCOL_MESSAGE",
          stage: "protocol",
          message: "Targeted capture requires a confirmed rectangle.",
          userMessageKey: "errors.captureTarget",
          retryable: false,
          fallbackAllowed: false,
          causeCode: "CaptureTargetMissing",
          safeContext: { jobId: job.id },
        }),
      );
    }
    const resumablePageNative =
      job.mode === "scroll-area" &&
      (job.state === "preparing" ||
        (job.state === "capturing" && job.documentPageMap?.complete === true) ||
        job.state === "paused");
    if (job.state !== "created" && !resumablePageNative) {
      return;
    }

    if (job.state === "created") {
      job = await this.jobs.transition(job.id, "preparing");
    } else if (job.state === "paused") {
      const canResumeCapture =
        job.tilePlan.length > 0 &&
        job.activeEngine !== undefined &&
        job.documentPageMap?.complete === true;
      job = await this.jobs.transition(job.id, canResumeCapture ? "capturing" : "preparing", {
        error: undefined,
      });
    }
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
    let activeEngine: CaptureEngine | undefined;
    let activeContext: CaptureEngineContext | undefined;

    try {
      const preparation =
        this.preparePage && this.pages !== undefined
          ? await this.pages.prepare({
              tabId: job.tabId,
              preparationId: job.id,
              options: {
                targetStartX: job.targetRect?.x ?? 0,
                targetStartY: job.targetRect?.y ?? 0,
                maxCssHeight: job.settings.limits.maxCssHeight,
                lazyLoad: job.settings.lazyLoad,
              },
            })
          : undefined;
      prepared = preparation !== undefined;
      cancellation.throwIfCancelled("prepare");
      job = await this.revalidateTarget(job);

      const preferred =
        job.preferredEngine === "scroll" && this.fallbackEngine !== undefined
          ? this.fallbackEngine
          : this.engine;
      const fallback = preferred === this.engine ? this.fallbackEngine : undefined;
      const engines = fallback === undefined ? [preferred] : [preferred, fallback];

      for (let attempt = 0; attempt < engines.length; attempt += 1) {
        const selected = engines[attempt] as CaptureEngine;
        job = await this.revalidateTarget(await this.requireJob(job.id));
        if (attempt > 0) {
          cancellation.throwIfCancelled("capture");
          await this.resetForFallback(job.id);
          const current = await this.requireJob(job.id);
          await this.publish({
            jobId: job.id,
            state: current.state,
            stage: "fallback",
            completed: 0,
            total: 0,
          });
        }

        const pageNativeResumeTiles =
          job.mode === "scroll-area" &&
          job.documentPageMap?.complete === true &&
          job.metrics !== undefined &&
          job.targetRect !== undefined
            ? await this.durablePageNativeResumeTiles(job)
            : undefined;
        const context: CaptureEngineContext = {
          jobId: job.id,
          tabId: job.tabId,
          windowId: job.windowId,
          settings: job.settings,
          ...(job.targetRect === undefined ? {} : { targetRect: job.targetRect }),
          ...(job.targetDescriptor === undefined ? {} : { targetDescriptor: job.targetDescriptor }),
          ...(preparation === undefined ? {} : { preparation }),
          ...(job.mode === "scroll-area" &&
          job.documentPageMap?.complete === true &&
          job.metrics !== undefined &&
          job.targetRect !== undefined
            ? {
                pageNativeResume: {
                  tilePlan: pageNativeResumeTiles ?? [],
                  metrics: job.metrics,
                  targetRect: job.targetRect,
                  documentPageMap: job.documentPageMap,
                },
              }
            : {}),
          cancellation,
          onPlan: (metrics, targetRect, tiles, enginePartialCapture, documentPageMap) => {
            const preparationPartialCapture: PartialCapture | undefined =
              preparation?.completionReason === "max-css-height"
                ? {
                    reason: "max-css-height",
                    capturedRect: targetRect,
                    limitValue: job.settings.limits.maxCssHeight,
                  }
                : preparation?.completionReason === "max-duration"
                  ? {
                      reason: "max-duration",
                      capturedRect: targetRect,
                      limitValue: job.settings.lazyLoad.maxDurationMs,
                    }
                  : undefined;
            return this.recordPlan(
              job.id,
              selected,
              metrics,
              targetRect,
              tiles,
              enginePartialCapture ?? preparationPartialCapture,
              documentPageMap,
            );
          },
          discardTilesFromIndex: (firstIndex) => this.discardTilesFromIndex(job.id, firstIndex),
          storeTile: (tile, blob) => this.storeTile(job.id, tile, blob),
          reportProgress: (progress) => this.publish(progress),
        };
        activeEngine = selected;
        activeContext = context;

        try {
          await selected.capture(context);
          cancellation.throwIfCancelled("capture");
          operationError = undefined;
          break;
        } catch (error) {
          operationError = error;
          const canFallback =
            attempt === 0 &&
            engines.length > 1 &&
            !cancellation.cancelled &&
            fallbackAllowed(error);
          if (!canFallback) {
            break;
          }
        }
      }
    } catch (error) {
      operationError = error;
    }

    if (activeEngine?.cleanup !== undefined && activeContext !== undefined) {
      try {
        await activeEngine.cleanup(activeContext);
      } catch (error) {
        restoreError = error;
      }
    }

    if (prepared) {
      const current = await this.requireJob(job.id);
      await this.publish({
        jobId: job.id,
        state: current.state,
        stage: "restoring",
        completed: current.completedTiles,
        total: current.totalTiles,
      });
      try {
        await this.pages?.restore(job.tabId, job.id);
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
      cancellation.throwIfCancelled("cleanup");
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
      cancellation.throwIfCancelled("cleanup");
      job = await this.jobs.transition(job.id, "ready", { cleanup });
      cancellation.throwIfCancelled("cleanup");
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
    engine: CaptureEngine,
    metrics: PageMetrics,
    targetRect: Rect,
    tiles: CaptureTile[],
    partialCapture?: PartialCapture,
    documentPageMap?: DocumentPageMap,
  ): Promise<void> {
    const job = await this.requireJob(jobId);
    const patch = {
      activeEngine: engine.kind,
      metrics,
      targetRect,
      tilePlan: tiles,
      completedTiles: tiles.filter((tile) => tile.status === "stored").length,
      totalTiles: tiles.length,
      ...(partialCapture === undefined ? {} : { partialCapture }),
      ...(documentPageMap === undefined ? {} : { documentPageMap }),
    };
    if (job.state === "preparing") {
      await this.jobs.transition(job.id, "capturing", patch);
      return;
    }
    if (job.state === "capturing") {
      await this.jobs.update(job.id, patch);
      return;
    }
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_PROTOCOL_MESSAGE",
        stage: "protocol",
        message: "A capture plan was produced in an invalid job state.",
        userMessageKey: "errors.jobState",
        retryable: true,
        fallbackAllowed: false,
        causeCode: "UnexpectedPlanState",
        safeContext: { jobId, state: job.state, engine: engine.kind },
      }),
    );
  }

  private async resetForFallback(jobId: string): Promise<void> {
    await this.tiles.deleteByJob(jobId);
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

  private async durablePageNativeResumeTiles(job: CaptureJob): Promise<CaptureTile[]> {
    const records = await this.tiles.listByJob(job.id);
    const storedByIndex = new Map(
      records
        .filter((record) => record.tile.status === "stored")
        .map((record) => [record.index, record.tile] as const),
    );
    return job.tilePlan
      .map((tile) => storedByIndex.get(tile.index))
      .filter((tile): tile is CaptureTile => tile !== undefined)
      .sort((left, right) => left.index - right.index);
  }

  private async discardTilesFromIndex(jobId: string, firstIndex: number): Promise<void> {
    const records = (await this.tiles.listByJob(jobId)).filter(
      (record) => record.index < firstIndex,
    );
    await this.tiles.deleteByJob(jobId);
    for (const record of records) {
      await this.tiles.put(record);
    }
  }

  private async settlePartialStop(jobId: string): Promise<boolean> {
    let job = await this.requireJob(jobId);
    if (job.state !== "capturing" || job.completedTiles === 0) {
      return false;
    }

    const selectedTiles = contiguousStoredPrefix(job.tilePlan);
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

    const wasComplete =
      selectedTiles.length === job.totalTiles &&
      selectedTiles.every((tile) => tile.status === "stored");
    const cleanup = cleanupState(undefined);
    job = await this.jobs.update(jobId, {
      targetRect: capturedRect,
      tilePlan: selectedTiles,
      completedTiles: selectedTiles.length,
      totalTiles: selectedTiles.length,
      cleanup,
      ...(wasComplete
        ? {}
        : {
            partialCapture: {
              reason: "user-stop",
              capturedRect,
              limitValue: selectedTiles.length,
            },
          }),
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
    if (
      primary.code === "E_STORAGE_QUOTA" &&
      job.mode === "scroll-area" &&
      (job.state === "preparing" || job.state === "capturing")
    ) {
      await this.jobs.transition(job.id, "paused", { cleanup, error: primary });
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
    try {
      await this.progress.publish(progress);
    } catch {
      // Progress delivery is best-effort; persistent job state is authoritative.
    }
  }
}
