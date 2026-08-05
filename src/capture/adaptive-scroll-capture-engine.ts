import { CaptureRateLimiter } from "@background/capture-rate-limiter";
import { dataUrlToBlob } from "@background/data-url";
import { parsePngDataUrl } from "@background/png-metadata";
import type {
  ScrollCapturePageAdapter,
  ScrollCapturePageResult,
} from "@background/scroll-capture-page-adapter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import type {
  CaptureEngine,
  CaptureEngineContext,
  CaptureEngineResult,
} from "@capture/capture-engine";
import { planAdaptiveCaptureRow } from "@capture/adaptive-frontier-planner";
import {
  ADAPTIVE_BOTTOM_EPSILON_CSS,
  ADAPTIVE_STABLE_BOTTOM_ROUNDS,
  observeStableEnd,
} from "@capture/stable-end-detector";
import {
  ADAPTIVE_CAPTURE_MAX_DURATION_MS,
  FALLBACK_OVERLAP_CSS,
  VISIBLE_CAPTURE_MIN_INTERVAL_MS,
} from "@shared/constants";
import type {
  AdaptiveCaptureFrontier,
  CaptureTile,
  PageMetrics,
  PartialCapture,
  PartialCaptureReason,
  Rect,
} from "@shared/contracts/domain";
import {
  WebCapRuntimeError,
  createWebCapError,
  createWebCapRuntimeError,
} from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";

export interface AdaptiveScrollCaptureEngineOptions {
  pages: ScrollCapturePageAdapter;
  tabs: TabsCaptureAdapter;
  limiter?: CaptureRateLimiter;
  overlapCss?: number;
  maxDurationMs?: number;
  now?: () => Date;
}

interface CapturePixelScale {
  x: number;
  y: number;
}

interface PartialStop {
  reason: PartialCaptureReason;
  limitValue?: number;
}

function captureError(options: {
  code:
    | "E_PROTOCOL_MESSAGE"
    | "E_TAB_NOT_ACTIVE"
    | "E_LAYOUT_UNSTABLE"
    | "E_CAPTURE_EMPTY"
    | "E_STORAGE_QUOTA";
  message: string;
  userMessageKey: string;
  causeCode: string;
  retryable?: boolean;
  safeContext?: Record<string, string | number | boolean>;
}): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: options.code,
      stage: options.code === "E_STORAGE_QUOTA" ? "storage" : "capture",
      message: options.message,
      userMessageKey: options.userMessageKey,
      retryable: options.retryable ?? true,
      fallbackAllowed: false,
      causeCode: options.causeCode,
      ...(options.safeContext === undefined ? {} : { safeContext: options.safeContext }),
    }),
  );
}

function metricsFromPage(result: ScrollCapturePageResult): PageMetrics {
  return {
    document: { x: 0, y: 0, width: result.documentWidth, height: result.documentHeight },
    layoutViewport: {
      x: result.actualScrollX,
      y: result.actualScrollY,
      width: result.viewportWidth,
      height: result.viewportHeight,
    },
    visualViewport: {
      x: result.actualScrollX,
      y: result.actualScrollY,
      width: result.viewportWidth,
      height: result.viewportHeight,
      scale: 1,
    },
    devicePixelRatio: result.devicePixelRatio,
    zoomFactor: 1,
    scrollX: result.actualScrollX,
    scrollY: result.actualScrollY,
  };
}

function validatePixelDimensions(
  page: Pick<ScrollCapturePageResult, "viewportWidth" | "viewportHeight" | "devicePixelRatio">,
  actual: { width: number; height: number },
  tileIndex: number,
  expectedScale: CapturePixelScale | undefined,
): CapturePixelScale {
  const scaleX = actual.width / page.viewportWidth;
  const scaleY = actual.height / page.viewportHeight;
  const dimensionsArePlausible =
    Number.isFinite(scaleX) &&
    Number.isFinite(scaleY) &&
    scaleX >= 0.25 &&
    scaleX <= 8 &&
    scaleY >= 0.25 &&
    scaleY <= 8;
  if (dimensionsArePlausible && expectedScale === undefined) {
    return { x: scaleX, y: scaleY };
  }
  const stableScale = expectedScale ?? { x: scaleX, y: scaleY };
  const expectedWidth = Math.max(1, Math.round(page.viewportWidth * stableScale.x));
  const expectedHeight = Math.max(1, Math.round(page.viewportHeight * stableScale.y));
  if (
    dimensionsArePlausible &&
    Math.abs(actual.width - expectedWidth) <= 2 &&
    Math.abs(actual.height - expectedHeight) <= 2
  ) {
    return stableScale;
  }
  throw captureError({
    code: "E_LAYOUT_UNSTABLE",
    message: "The visible screenshot pixel scale changed during adaptive capture.",
    userMessageKey: "errors.pixelScaleMismatch",
    causeCode: "AdaptivePixelScaleMismatch",
    safeContext: {
      tileIndex,
      actualWidth: actual.width,
      actualHeight: actual.height,
      expectedWidth,
      expectedHeight,
      devicePixelRatio: page.devicePixelRatio,
    },
  });
}

function replaceTile(tiles: CaptureTile[], replacement: CaptureTile): CaptureTile[] {
  return tiles.map((tile) => (tile.index === replacement.index ? replacement : tile));
}

function rowBottom(tiles: CaptureTile[]): number | undefined {
  const bottoms = tiles
    .map((tile) => tile.outputRectCss)
    .filter((rect): rect is Rect => rect !== undefined)
    .map((rect) => rect.y + rect.height);
  return bottoms.length === 0 ? undefined : Math.max(...bottoms);
}

function storedBytes(tiles: CaptureTile[]): number {
  return tiles.reduce(
    (total, tile) => total + (tile.status === "stored" ? (tile.byteLength ?? 0) : 0),
    0,
  );
}

function reconcileCommittedRows(
  frontier: AdaptiveCaptureFrontier,
  tiles: CaptureTile[],
): AdaptiveCaptureFrontier {
  let capturedRows = 0;
  let capturedBottomCss = 0;
  const rows = new Map<number, CaptureTile[]>();
  for (const tile of tiles) {
    const group = rows.get(tile.row) ?? [];
    group.push(tile);
    rows.set(tile.row, group);
  }
  while (true) {
    const row = rows.get(capturedRows);
    if (row === undefined || row.length === 0 || row.some((tile) => tile.status !== "stored")) {
      break;
    }
    const bottom = rowBottom(row);
    if (bottom === undefined || bottom <= capturedBottomCss) {
      break;
    }
    capturedBottomCss = bottom;
    capturedRows += 1;
  }
  const committedBottom = Math.max(frontier.capturedBottomCss, capturedBottomCss);
  return {
    ...frontier,
    capturedRows: Math.max(frontier.capturedRows, capturedRows),
    capturedBottomCss: committedBottom,
    nextYCss: committedBottom,
    storedBytes: storedBytes(tiles),
  };
}

function deriveCaptureScale(
  frontier: AdaptiveCaptureFrontier,
  tiles: CaptureTile[],
): CapturePixelScale | undefined {
  const stored = tiles.find(
    (tile) =>
      tile.status === "stored" && tile.expectedPixelWidth > 0 && tile.expectedPixelHeight > 0,
  );
  return stored === undefined
    ? undefined
    : {
        x: stored.expectedPixelWidth / frontier.viewportWidthCss,
        y: stored.expectedPixelHeight / frontier.viewportHeightCss,
      };
}

function targetRect(frontier: AdaptiveCaptureFrontier, documentWidth: number, maxWidth: number): Rect {
  return {
    x: 0,
    y: 0,
    width: Math.min(documentWidth, maxWidth),
    height: frontier.capturedBottomCss,
  };
}

function partialCapture(
  frontier: AdaptiveCaptureFrontier,
  documentWidth: number,
  maxWidth: number,
  stop: PartialStop,
): PartialCapture {
  return {
    reason: stop.reason,
    capturedRect: targetRect(frontier, documentWidth, maxWidth),
    ...(stop.limitValue === undefined ? {} : { limitValue: stop.limitValue }),
  };
}

function validateIdentity(
  frontier: AdaptiveCaptureFrontier,
  page: ScrollCapturePageResult,
  tileIndex: number,
): void {
  const widthChanged = Math.abs(page.documentWidth - frontier.viewportWidthCss) > 2;
  if (page.documentToken !== frontier.sourceDocumentToken) {
    throw captureError({
      code: "E_LAYOUT_UNSTABLE",
      message: "The source tab navigated while adaptive capture was in progress.",
      userMessageKey: "errors.layoutChanged",
      causeCode: "AdaptiveDocumentChanged",
      safeContext: { tileIndex },
    });
  }
  if (
    Math.abs(page.viewportWidth - frontier.viewportWidthCss) > 2 ||
    Math.abs(page.viewportHeight - frontier.viewportHeightCss) > 2 ||
    Math.abs(page.devicePixelRatio - frontier.devicePixelRatio) > 0.01
  ) {
    throw captureError({
      code: "E_LAYOUT_UNSTABLE",
      message: "The viewport or device scale changed during adaptive capture.",
      userMessageKey: "errors.layoutChanged",
      causeCode: "AdaptiveViewportChanged",
      safeContext: {
        tileIndex,
        viewportWidth: page.viewportWidth,
        viewportHeight: page.viewportHeight,
        devicePixelRatio: page.devicePixelRatio,
      },
    });
  }
  if (page.documentHeight + ADAPTIVE_BOTTOM_EPSILON_CSS < frontier.capturedBottomCss) {
    throw captureError({
      code: "E_LAYOUT_UNSTABLE",
      message: "The document became shorter than the stored adaptive prefix.",
      userMessageKey: "errors.layoutChanged",
      causeCode: "AdaptiveDocumentShrank",
      safeContext: {
        tileIndex,
        documentHeight: page.documentHeight,
        capturedBottomCss: frontier.capturedBottomCss,
      },
    });
  }
  if (widthChanged) {
    throw captureError({
      code: "E_LAYOUT_UNSTABLE",
      message: "The document width changed during adaptive capture.",
      userMessageKey: "errors.layoutChanged",
      causeCode: "AdaptiveWidthChanged",
      safeContext: {
        tileIndex,
        documentWidth: page.documentWidth,
        expectedWidth: frontier.viewportWidthCss,
      },
    });
  }
}

function isStorageLimit(error: unknown): boolean {
  return (
    error instanceof WebCapRuntimeError &&
    (error.code === "E_STORAGE_QUOTA" || error.code === "E_STORAGE_WRITE")
  );
}

export class AdaptiveScrollCaptureEngine implements CaptureEngine {
  readonly kind = "scroll" as const;
  readonly adaptive = true as const;
  private readonly pages: ScrollCapturePageAdapter;
  private readonly tabs: TabsCaptureAdapter;
  private readonly limiter: CaptureRateLimiter;
  private readonly overlapCss: number;
  private readonly maxDurationMs: number;
  private readonly now: () => Date;

  constructor(options: AdaptiveScrollCaptureEngineOptions) {
    this.pages = options.pages;
    this.tabs = options.tabs;
    this.limiter =
      options.limiter ??
      new CaptureRateLimiter({ minimumIntervalMs: VISIBLE_CAPTURE_MIN_INTERVAL_MS });
    this.overlapCss = options.overlapCss ?? FALLBACK_OVERLAP_CSS;
    this.maxDurationMs = options.maxDurationMs ?? ADAPTIVE_CAPTURE_MAX_DURATION_MS;
    this.now = options.now ?? (() => new Date());
  }

  async capture(context: CaptureEngineContext): Promise<CaptureEngineResult> {
    const preparation = context.preparation;
    const windowId = context.windowId;
    if (
      preparation === undefined ||
      windowId === undefined ||
      context.checkpointFrontier === undefined
    ) {
      throw captureError({
        code: "E_PROTOCOL_MESSAGE",
        message: "Adaptive capture requires prepared-page, window, and checkpoint context.",
        userMessageKey: "errors.scrollCaptureContext",
        causeCode: "MissingAdaptiveCaptureContext",
        retryable: false,
      });
    }
    if (context.mode !== undefined && context.mode !== "full-page") {
      throw captureError({
        code: "E_PROTOCOL_MESSAGE",
        message: "Adaptive capture only supports full-page jobs.",
        userMessageKey: "errors.captureMode",
        causeCode: "AdaptiveModeMismatch",
        retryable: false,
      });
    }

    let tiles = context.resume?.tilePlan.map((tile) => ({ ...tile })) ?? [];
    let frontier = context.resume?.frontier;
    let metrics = context.resume?.metrics;
    const initialProbeY =
      frontier === undefined
        ? 0
        : Math.max(
            0,
            Math.min(
              frontier.nextYCss - this.overlapCss,
              frontier.observedDocumentHeightCss - frontier.viewportHeightCss,
            ),
          );
    const initial = await this.probe(context, preparation.preparationId, initialProbeY, frontier);
    if (frontier === undefined) {
      const nowIso = this.now().toISOString();
      frontier = {
        schemaVersion: 1,
        nextYCss: 0,
        capturedBottomCss: 0,
        observedDocumentHeightCss: initial.documentHeight,
        stableBottomRounds: 0,
        capturedRows: 0,
        storedBytes: 0,
        startedAt: nowIso,
        lastGrowthAt: nowIso,
        sourceDocumentToken: initial.documentToken,
        viewportWidthCss: initial.viewportWidth,
        viewportHeightCss: initial.viewportHeight,
        devicePixelRatio: initial.devicePixelRatio,
      };
    } else {
      validateIdentity(frontier, initial, tiles.length);
      if (initial.documentHeight > frontier.observedDocumentHeightCss + ADAPTIVE_BOTTOM_EPSILON_CSS) {
        frontier = {
          ...frontier,
          observedDocumentHeightCss: initial.documentHeight,
          stableBottomRounds: 0,
          lastGrowthAt: this.now().toISOString(),
        };
      }
    }
    metrics = metricsFromPage(initial);
    frontier = reconcileCommittedRows(frontier, tiles);
    await context.checkpointFrontier(frontier);
    let captureScale = deriveCaptureScale(frontier, tiles);

    while (true) {
      context.cancellation.throwIfCancelled("capture");
      const pendingRow = tiles
        .filter((tile) => tile.row === frontier.capturedRows)
        .sort((left, right) => left.column - right.column);
      if (pendingRow.length > 0) {
        const pendingBottom = rowBottom(pendingRow);
        if (pendingBottom === undefined) {
          throw captureError({
            code: "E_PROTOCOL_MESSAGE",
            message: "The persisted adaptive row has no output coverage.",
            userMessageKey: "errors.tilePlan",
            causeCode: "AdaptivePendingRowInvalid",
            retryable: false,
          });
        }
        const isFinalRow =
          frontier.stableBottomRounds > ADAPTIVE_STABLE_BOTTOM_ROUNDS &&
          pendingBottom >= frontier.observedDocumentHeightCss - ADAPTIVE_BOTTOM_EPSILON_CSS;
        const result = await this.capturePlannedRow(
          context,
          preparation.preparationId,
          windowId,
          frontier,
          metrics,
          tiles,
          pendingRow,
          captureScale,
          isFinalRow,
        );
        if (result.partial !== undefined) {
          return this.finishPartial(context, result.frontier, result.metrics, result.tiles, result.partial);
        }
        frontier = reconcileCommittedRows(result.frontier, result.tiles);
        tiles = result.tiles;
        metrics = result.metrics;
        captureScale = result.captureScale;
        if (!isFinalRow) {
          frontier = { ...frontier, stableBottomRounds: 0 };
        }
        await context.checkpointFrontier(frontier);
        if (isFinalRow) {
          const finalTarget = targetRect(
            frontier,
            metrics.document.width,
            context.settings.limits.maxCssWidth,
          );
          await context.onPlan(metrics, finalTarget, tiles);
          return { metrics, targetRect: finalTarget, tiles };
        }
        continue;
      }

      const guard = this.guard(frontier, tiles, context.settings.limits.maxTiles, context.settings.limits.maxEstimatedBytes);
      if (guard !== undefined) {
        return this.finishPartial(context, frontier, metrics, tiles, guard);
      }

      const probeY = Math.max(
        0,
        Math.min(
          frontier.nextYCss - this.overlapCss,
          frontier.observedDocumentHeightCss - frontier.viewportHeightCss,
        ),
      );
      const page = await this.probe(context, preparation.preparationId, probeY, frontier);
      validateIdentity(frontier, page, tiles.length);
      metrics = metricsFromPage(page);
      const observed = observeStableEnd(frontier, {
        actualScrollY: page.actualScrollY,
        viewportHeight: page.viewportHeight,
        documentHeight: page.documentHeight,
        stableSamples: page.stableSamples,
        mutationCount: page.mutationCount,
        observedAt: this.now().toISOString(),
      });
      frontier = observed.frontier;
      await context.checkpointFrontier(frontier);
      if (observed.atBottom && !observed.complete) {
        continue;
      }

      const rowPlan = planAdaptiveCaptureRow({
        jobId: context.jobId,
        nextTileIndex: tiles.length,
        row: frontier.capturedRows,
        nextYCss: frontier.nextYCss,
        documentWidthCss: page.documentWidth,
        documentHeightCss: page.documentHeight,
        viewportWidthCss: page.viewportWidth,
        viewportHeightCss: page.viewportHeight,
        maxCssWidth: context.settings.limits.maxCssWidth,
        overlapCss: this.overlapCss,
        remainingTiles: context.settings.limits.maxTiles - tiles.length,
      });
      if (rowPlan.limitedByMaxTiles || rowPlan.tiles.length === 0) {
        return this.finishPartial(context, frontier, metrics, tiles, {
          reason: "max-tiles",
          limitValue: context.settings.limits.maxTiles,
        });
      }
      const averageBytes = frontier.storedBytes / Math.max(1, tiles.filter((tile) => tile.status === "stored").length);
      if (
        averageBytes > 0 &&
        frontier.storedBytes + averageBytes * rowPlan.tiles.length >
          context.settings.limits.maxEstimatedBytes
      ) {
        return this.finishPartial(context, frontier, metrics, tiles, {
          reason: "max-estimated-bytes",
          limitValue: context.settings.limits.maxEstimatedBytes,
        });
      }

      tiles = [...tiles, ...rowPlan.tiles];
      const plannedTarget: Rect = {
        x: 0,
        y: 0,
        width: rowPlan.targetWidthCss,
        height: rowPlan.outputBottomCss,
      };
      await context.onPlan(metrics, plannedTarget, tiles);
      const rowResult = await this.capturePlannedRow(
        context,
        preparation.preparationId,
        windowId,
        frontier,
        metrics,
        tiles,
        rowPlan.tiles,
        captureScale,
        observed.complete,
      );
      if (rowResult.partial !== undefined) {
        return this.finishPartial(
          context,
          rowResult.frontier,
          rowResult.metrics,
          rowResult.tiles,
          rowResult.partial,
        );
      }
      tiles = rowResult.tiles;
      metrics = rowResult.metrics;
      captureScale = rowResult.captureScale;
      frontier = reconcileCommittedRows(rowResult.frontier, tiles);
      if (!observed.complete) {
        frontier = { ...frontier, stableBottomRounds: 0 };
      }
      await context.checkpointFrontier(frontier);
      if (observed.complete) {
        const finalTarget = targetRect(
          frontier,
          metrics.document.width,
          context.settings.limits.maxCssWidth,
        );
        await context.onPlan(metrics, finalTarget, tiles);
        return { metrics, targetRect: finalTarget, tiles };
      }
    }
  }

  async cleanup(context: CaptureEngineContext): Promise<void> {
    const preparation = context.preparation;
    if (preparation === undefined) {
      return;
    }
    const result = await this.pages.cleanup(
      context.tabId,
      context.jobId,
      preparation.preparedScroll.x,
      preparation.preparedScroll.y,
    );
    if (result.skippedElements > 0) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_CLEANUP_PARTIAL",
          stage: "cleanup",
          message: "Some adaptive fixed-element changes were modified by the page.",
          userMessageKey: "errors.cleanupPartial",
          retryable: true,
          fallbackAllowed: false,
          causeCode: "AdaptiveScrollMutationChanged",
          safeContext: {
            tabId: context.tabId,
            restoredElements: result.restoredElements,
            skippedElements: result.skippedElements,
          },
        }),
      );
    }
  }

  private guard(
    frontier: AdaptiveCaptureFrontier,
    tiles: CaptureTile[],
    maxTiles: number,
    maxEstimatedBytes: number,
  ): PartialStop | undefined {
    if (this.now().getTime() - Date.parse(frontier.startedAt) >= this.maxDurationMs) {
      return { reason: "max-duration", limitValue: this.maxDurationMs };
    }
    if (tiles.length >= maxTiles) {
      return { reason: "max-tiles", limitValue: maxTiles };
    }
    if (frontier.storedBytes >= maxEstimatedBytes) {
      return { reason: "max-estimated-bytes", limitValue: maxEstimatedBytes };
    }
    return undefined;
  }

  private async finishPartial(
    context: CaptureEngineContext,
    frontier: AdaptiveCaptureFrontier,
    metrics: PageMetrics | undefined,
    tiles: CaptureTile[],
    stop: PartialStop,
  ): Promise<CaptureEngineResult> {
    if (frontier.capturedBottomCss <= 0 || tiles.length === 0 || metrics === undefined) {
      throw captureError({
        code: stop.reason === "storage-quota" ? "E_STORAGE_QUOTA" : "E_CAPTURE_EMPTY",
        message: "Adaptive capture reached a resource guard before storing a complete row.",
        userMessageKey:
          stop.reason === "storage-quota" ? "errors.storageQuota" : "errors.captureEmpty",
        causeCode: "AdaptiveGuardBeforePrefix",
        safeContext: { reason: stop.reason },
      });
    }
    const selectedTiles = tiles.filter(
      (tile) =>
        tile.status === "stored" &&
        tile.outputRectCss !== undefined &&
        tile.outputRectCss.y + tile.outputRectCss.height <=
          frontier.capturedBottomCss + ADAPTIVE_BOTTOM_EPSILON_CSS,
    );
    const partial = partialCapture(
      frontier,
      metrics.document.width,
      context.settings.limits.maxCssWidth,
      stop,
    );
    await context.onPlan(metrics, partial.capturedRect, selectedTiles, partial);
    return {
      metrics,
      targetRect: partial.capturedRect,
      tiles: selectedTiles,
      partialCapture: partial,
    };
  }

  private async probe(
    context: CaptureEngineContext,
    preparationId: string,
    scrollY: number,
    frontier: AdaptiveCaptureFrontier | undefined,
  ): Promise<ScrollCapturePageResult> {
    context.cancellation.throwIfCancelled("measure");
    await context.reportProgress({
      jobId: context.jobId,
      state: frontier === undefined ? "preparing" : "capturing",
      stage: "scrolling",
      completed: context.resume?.tilePlan.filter((tile) => tile.status === "stored").length ?? 0,
      total: context.resume?.tilePlan.length ?? 0,
    });
    return this.pages.scrollAndSettle({
      tabId: context.tabId,
      preparationId,
      scrollX: 0,
      scrollY,
      tileIndex: context.resume?.tilePlan.length ?? 0,
      totalTiles: Math.max(1, context.settings.limits.maxTiles),
      fixedElementMode: "preserve",
      settleMs: context.settings.lazyLoad.settleMs,
      expectedDocumentWidth: frontier?.viewportWidthCss ?? context.preparation?.documentWidth ?? 1,
      expectedDocumentHeight:
        frontier?.observedDocumentHeightCss ?? context.preparation?.documentHeight ?? 1,
    });
  }

  private async capturePlannedRow(
    context: CaptureEngineContext,
    preparationId: string,
    windowId: number,
    frontier: AdaptiveCaptureFrontier,
    currentMetrics: PageMetrics | undefined,
    allTiles: CaptureTile[],
    rowTiles: CaptureTile[],
    initialScale: CapturePixelScale | undefined,
    isFinalRow: boolean,
  ): Promise<{
    frontier: AdaptiveCaptureFrontier;
    metrics: PageMetrics;
    tiles: CaptureTile[];
    captureScale: CapturePixelScale | undefined;
    partial?: PartialStop;
  }> {
    let tiles = allTiles;
    let captureScale = initialScale;
    let metrics = currentMetrics;
    const firstIndex = Math.min(...rowTiles.map((tile) => tile.index));
    for (const planned of rowTiles) {
      if (planned.status === "stored") {
        continue;
      }
      context.cancellation.throwIfCancelled("capture");
      await this.ensureActiveTab(context.tabId, windowId);
      const page = await this.pages.scrollAndSettle({
        tabId: context.tabId,
        preparationId,
        scrollX: planned.scrollXCss ?? planned.sourceRectCss.x,
        scrollY: planned.scrollYCss ?? planned.sourceRectCss.y,
        tileIndex: planned.index,
        totalTiles: isFinalRow ? tiles.length : context.settings.limits.maxTiles,
        fixedElementMode: context.settings.fixedElementMode,
        settleMs: context.settings.lazyLoad.settleMs,
        expectedDocumentWidth: frontier.viewportWidthCss,
        expectedDocumentHeight: frontier.observedDocumentHeightCss,
        isFirstRow: planned.row === 0,
        isFinalRow,
      });
      validateIdentity(frontier, page, planned.index);
      if (page.scrollSnapped) {
        throw captureError({
          code: "E_LAYOUT_UNSTABLE",
          message: "The page changed the requested adaptive scroll position.",
          userMessageKey: "errors.scrollSnap",
          causeCode: "AdaptiveScrollPositionMismatch",
          safeContext: {
            tileIndex: planned.index,
            requestedX: planned.scrollXCss ?? planned.sourceRectCss.x,
            requestedY: planned.scrollYCss ?? planned.sourceRectCss.y,
            actualX: page.actualScrollX,
            actualY: page.actualScrollY,
          },
        });
      }
      metrics = metricsFromPage(page);
      await context.reportProgress({
        jobId: context.jobId,
        state: "capturing",
        stage: "capturing",
        completed: tiles.filter((tile) => tile.status === "stored").length,
        total: tiles.length,
        tileIndex: planned.index,
      });

      let dataUrl: string;
      try {
        dataUrl = await this.limiter.run(() => this.tabs.captureVisibleTab(windowId));
      } catch (error) {
        throw createWebCapRuntimeError(
          normalizeError(error, {
            code: "E_CAPTURE_RATE_LIMIT",
            stage: "capture",
            userMessageKey: "errors.scrollCapture",
            retryable: true,
            fallbackAllowed: false,
            safeContext: { tabId: context.tabId, tileIndex: planned.index },
          }),
        );
      }
      const metadata = parsePngDataUrl(dataUrl);
      if (!metadata.ok) {
        throw createWebCapRuntimeError(metadata.error);
      }
      captureScale = validatePixelDimensions(page, metadata.value, planned.index, captureScale);
      const blob = dataUrlToBlob(dataUrl);
      if (blob.size === 0) {
        throw captureError({
          code: "E_CAPTURE_EMPTY",
          message: "Adaptive capture returned an empty screenshot.",
          userMessageKey: "errors.captureEmpty",
          causeCode: "EmptyAdaptiveVisibleCapture",
          safeContext: { tileIndex: planned.index },
        });
      }
      const captured: CaptureTile = {
        ...planned,
        sourceRectCss: {
          x: page.actualScrollX,
          y: page.actualScrollY,
          width: page.viewportWidth,
          height: page.viewportHeight,
        },
        scrollXCss: page.actualScrollX,
        scrollYCss: page.actualScrollY,
        expectedPixelWidth: metadata.value.width,
        expectedPixelHeight: metadata.value.height,
        fixedElementsHidden: page.hiddenFixedElements,
        status: "stored",
        attempts: planned.attempts + 1,
        byteLength: blob.size,
        mimeType: metadata.value.mimeType,
      };
      await context.reportProgress({
        jobId: context.jobId,
        state: "capturing",
        stage: "storing",
        completed: tiles.filter((tile) => tile.status === "stored").length,
        total: tiles.length,
        tileIndex: planned.index,
      });
      try {
        await context.storeTile(captured, blob);
      } catch (error) {
        if (
          isStorageLimit(error) &&
          frontier.capturedRows > 0 &&
          context.discardTilesFromIndex !== undefined
        ) {
          await context.discardTilesFromIndex(firstIndex);
          return {
            frontier,
            metrics,
            tiles: tiles.filter((tile) => tile.index < firstIndex),
            captureScale,
            partial: { reason: "storage-quota" },
          };
        }
        throw error;
      }
      tiles = replaceTile(tiles, captured);
    }
    if (metrics === undefined) {
      throw captureError({
        code: "E_PROTOCOL_MESSAGE",
        message: "Adaptive row capture completed without page metrics.",
        userMessageKey: "errors.scrollCaptureProtocol",
        causeCode: "AdaptiveMetricsMissing",
        retryable: false,
      });
    }
    const nextFrontier = reconcileCommittedRows(frontier, tiles);
    return { frontier: nextFrontier, metrics, tiles, captureScale };
  }

  private async ensureActiveTab(tabId: number, windowId: number): Promise<void> {
    const active = await this.tabs.queryActiveTab();
    if (active?.id !== tabId || active.windowId !== windowId || !active.active) {
      throw captureError({
        code: "E_TAB_NOT_ACTIVE",
        message: "Adaptive capture requires the source tab to remain active.",
        userMessageKey: "errors.tabNotActive",
        causeCode: "AdaptiveTabNotActive",
        safeContext: { tabId, windowId },
      });
    }
  }
}
