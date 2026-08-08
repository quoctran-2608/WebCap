import { CaptureRateLimiter } from "@background/capture-rate-limiter";
import { dataUrlToBlob } from "@background/data-url";
import { parsePngDataUrl } from "@background/png-metadata";
import type { ScrollAreaPageAdapter } from "@background/scroll-area-page-adapter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import type {
  CaptureEngine,
  CaptureEngineContext,
  CaptureEngineResult,
} from "@capture/capture-engine";
import { AdaptivePageBatchController } from "@capture/adaptive-page-batch-controller";
import {
  PdfStoragePressureController,
  type PdfStoragePressurePort,
} from "@capture/pdf-storage-pressure-controller";
import {
  planPdfPageCaptureTiles,
  type PdfPageCapturePlan,
} from "@capture/pdf-page-capture-planner";
import { FALLBACK_OVERLAP_CSS, VISIBLE_CAPTURE_MIN_INTERVAL_MS } from "@shared/constants";
import type {
  CaptureTile,
  DocumentPage,
  DocumentPageMap,
  PageMetrics,
  Rect,
} from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";

const PDF_PAGE_MAX_TILES = 4_096;
const PDF_BATCH_MAX_PAGES = 25;
const PDF_BATCH_MIN_ESTIMATED_BYTES = 4 * 1024 * 1024;
const RECT_EPSILON_CSS = 0.05;

interface CapturePixelScale {
  x: number;
  y: number;
}

export interface PageNativeCaptureEngineOptions {
  pages: ScrollAreaPageAdapter;
  tabs: TabsCaptureAdapter;
  fallback: CaptureEngine;
  limiter?: CaptureRateLimiter;
  overlapCss?: number;
  nowMs?: () => number;
  storagePressure?: PdfStoragePressurePort;
}

function captureError(options: {
  code:
    | "E_PROTOCOL_MESSAGE"
    | "E_TAB_NOT_ACTIVE"
    | "E_LAYOUT_UNSTABLE"
    | "E_CAPTURE_EMPTY"
    | "E_CLEANUP_PARTIAL"
    | "E_TILE_PLAN";
  stage?: "capture" | "cleanup" | "plan" | "protocol";
  message: string;
  userMessageKey: string;
  causeCode: string;
  retryable?: boolean;
  safeContext?: Record<string, string | number | boolean>;
}): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: options.code,
      stage: options.stage ?? "capture",
      message: options.message,
      userMessageKey: options.userMessageKey,
      retryable: options.retryable ?? true,
      fallbackAllowed: false,
      causeCode: options.causeCode,
      ...(options.safeContext === undefined ? {} : { safeContext: options.safeContext }),
    }),
  );
}

function metricsFromContainer(result: {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  devicePixelRatio: number;
  actualScrollLeft: number;
  actualScrollTop: number;
}): PageMetrics {
  return {
    document: { x: 0, y: 0, width: result.scrollWidth, height: result.scrollHeight },
    layoutViewport: {
      x: result.actualScrollLeft,
      y: result.actualScrollTop,
      width: result.clientWidth,
      height: result.clientHeight,
    },
    visualViewport: {
      x: result.actualScrollLeft,
      y: result.actualScrollTop,
      width: result.clientWidth,
      height: result.clientHeight,
      scale: 1,
    },
    devicePixelRatio: result.devicePixelRatio,
    zoomFactor: 1,
    scrollX: result.actualScrollLeft,
    scrollY: result.actualScrollTop,
  };
}

function verifiedPageMap(pageMap: DocumentPageMap | undefined): pageMap is DocumentPageMap {
  return (
    pageMap?.strategy === "dom" &&
    pageMap.complete &&
    pageMap.confidence >= 0.8 &&
    pageMap.pages.length === pageMap.sourcePageCount &&
    pageMap.pages.every((page, index) => page.index === index)
  );
}

function pageMapExtent(pageMap: DocumentPageMap): { right: number; bottom: number } {
  return pageMap.pages.reduce(
    (extent, page) => ({
      right: Math.max(extent.right, page.sourceRectCss.x + page.sourceRectCss.width),
      bottom: Math.max(extent.bottom, page.sourceRectCss.y + page.sourceRectCss.height),
    }),
    { right: 0, bottom: 0 },
  );
}

function validatePixelDimensions(
  viewport: { width: number; height: number; devicePixelRatio: number },
  actual: { width: number; height: number },
  tileIndex: number,
  expectedScale: CapturePixelScale | undefined,
): CapturePixelScale {
  const scaleX = actual.width / viewport.width;
  const scaleY = actual.height / viewport.height;
  const plausible =
    Number.isFinite(scaleX) &&
    Number.isFinite(scaleY) &&
    scaleX >= 0.25 &&
    scaleX <= 8 &&
    scaleY >= 0.25 &&
    scaleY <= 8;
  if (plausible && expectedScale === undefined) return { x: scaleX, y: scaleY };
  const stable = expectedScale ?? { x: scaleX, y: scaleY };
  const expectedWidth = Math.max(1, Math.round(viewport.width * stable.x));
  const expectedHeight = Math.max(1, Math.round(viewport.height * stable.y));
  if (
    plausible &&
    Math.abs(actual.width - expectedWidth) <= 2 &&
    Math.abs(actual.height - expectedHeight) <= 2
  ) {
    return stable;
  }
  throw captureError({
    code: "E_LAYOUT_UNSTABLE",
    message: "The visible screenshot scale changed during page-native PDF capture.",
    userMessageKey: "errors.pixelScaleMismatch",
    causeCode: "PdfPagePixelScaleMismatch",
    safeContext: {
      tileIndex,
      actualWidth: actual.width,
      actualHeight: actual.height,
      scaleX,
      scaleY,
      expectedScaleX: stable.x,
      expectedScaleY: stable.y,
      devicePixelRatio: viewport.devicePixelRatio,
    },
  });
}

function intersectRect(left: Rect, right: Rect): Rect | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  if (rightEdge <= x || bottomEdge <= y) return undefined;
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

function sameRect(left: Rect, right: Rect): boolean {
  return (
    Math.abs(left.x - right.x) <= 0.05 &&
    Math.abs(left.y - right.y) <= 0.05 &&
    Math.abs(left.width - right.width) <= 0.05 &&
    Math.abs(left.height - right.height) <= 0.05
  );
}

function sameDocumentPageMap(left: DocumentPageMap, right: DocumentPageMap): boolean {
  return (
    left.strategy === right.strategy &&
    left.sourcePageCount === right.sourcePageCount &&
    left.pages.length === right.pages.length &&
    left.pages.every((page, index) => {
      const other = right.pages[index];
      return (
        other !== undefined &&
        page.index === other.index &&
        sameRect(page.sourceRectCss, other.sourceRectCss)
      );
    })
  );
}

function estimatedPageRasterBytes(page: DocumentPage, pixelScale: number): number {
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  return Math.max(
    4,
    Math.ceil(page.sourceRectCss.width * page.sourceRectCss.height * scale * scale * 4),
  );
}

function storagePauseError(
  pageIndex: number,
  availableBytes: number | undefined,
  requiredBytes: number,
): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_QUOTA",
      stage: "storage",
      message:
        "PDF capture paused at a verified page boundary because local storage is under pressure.",
      userMessageKey: "errors.storageQuota",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "PdfStoragePressurePaused",
      safeContext: {
        pageIndex,
        requiredBytes,
        ...(availableBytes === undefined ? {} : { availableBytes }),
      },
    }),
  );
}

function pageCoveredByTiles(page: Rect, tiles: readonly CaptureTile[]): boolean {
  const intersections = tiles
    .filter((tile) => tile.status === "stored")
    .map((tile) => intersectRect(page, tile.outputRectCss ?? tile.sourceRectCss))
    .filter((rect): rect is Rect => rect !== undefined);
  if (intersections.length === 0) return false;

  const yBreaks = new Set<number>([page.y, page.y + page.height]);
  for (const rect of intersections) {
    yBreaks.add(Math.max(page.y, rect.y));
    yBreaks.add(Math.min(page.y + page.height, rect.y + rect.height));
  }
  const orderedY = [...yBreaks].sort((left, right) => left - right);
  const pageRight = page.x + page.width;
  for (let index = 0; index < orderedY.length - 1; index += 1) {
    const top = orderedY[index];
    const bottom = orderedY[index + 1];
    if (top === undefined || bottom === undefined || bottom - top <= RECT_EPSILON_CSS) continue;
    const sampleY = (top + bottom) / 2;
    const intervals = intersections
      .filter(
        (rect) =>
          sampleY >= rect.y - RECT_EPSILON_CSS &&
          sampleY <= rect.y + rect.height + RECT_EPSILON_CSS,
      )
      .map((rect) => [Math.max(page.x, rect.x), Math.min(pageRight, rect.x + rect.width)] as const)
      .filter(([left, right]) => right > left)
      .sort((left, right) => left[0] - right[0]);
    if (intervals.length === 0) return false;
    let coveredRight = page.x;
    for (const [left, right] of intervals) {
      if (left > coveredRight + RECT_EPSILON_CSS) return false;
      coveredRight = Math.max(coveredRight, right);
    }
    if (coveredRight < pageRight - RECT_EPSILON_CSS) return false;
  }
  return true;
}

export class PageNativeCaptureEngine implements CaptureEngine {
  readonly kind = "scroll" as const;
  private readonly pages: ScrollAreaPageAdapter;
  private readonly tabs: TabsCaptureAdapter;
  private readonly fallback: CaptureEngine;
  private readonly limiter: CaptureRateLimiter;
  private readonly overlapCss: number;
  private readonly nowMs: () => number;
  private readonly storagePressure: PdfStoragePressurePort;

  constructor(options: PageNativeCaptureEngineOptions) {
    this.pages = options.pages;
    this.tabs = options.tabs;
    this.fallback = options.fallback;
    this.limiter =
      options.limiter ??
      new CaptureRateLimiter({ minimumIntervalMs: VISIBLE_CAPTURE_MIN_INTERVAL_MS });
    this.overlapCss = options.overlapCss ?? FALLBACK_OVERLAP_CSS;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.storagePressure = options.storagePressure ?? new PdfStoragePressureController();
  }

  async capture(context: CaptureEngineContext): Promise<CaptureEngineResult> {
    const descriptor = context.targetDescriptor;
    const windowId = context.windowId;
    if (
      descriptor === undefined ||
      descriptor.captureKind !== "full-scroll-content" ||
      windowId === undefined
    ) {
      throw captureError({
        code: "E_PROTOCOL_MESSAGE",
        stage: "protocol",
        message: "Page-native PDF capture requires a selected scrollable viewer.",
        userMessageKey: "errors.scrollAreaCapture",
        causeCode: "MissingPageNativeContext",
        retryable: false,
      });
    }

    context.cancellation.throwIfCancelled("measure");
    await context.reportProgress({
      jobId: context.jobId,
      state: "preparing",
      stage: "measuring",
      completed: 0,
      total: 0,
    });
    const initial = await this.pages.scrollAndSettle({
      tabId: context.tabId,
      jobId: context.jobId,
      descriptor,
      scrollLeft: 0,
      scrollTop: 0,
      row: 0,
      column: 0,
      rows: 1,
      columns: 1,
      fixedElementMode: "preserve",
      settleMs: context.settings.lazyLoad.settleMs,
    });
    if (!verifiedPageMap(initial.documentPageMap)) {
      return this.fallback.capture(context);
    }

    const documentPageMap = initial.documentPageMap;
    const extent = pageMapExtent(documentPageMap);
    const targetRect: Rect = {
      x: 0,
      y: 0,
      width: Math.max(initial.scrollWidth, extent.right),
      height: Math.max(initial.scrollHeight, extent.bottom),
    };
    if (targetRect.width <= 0 || targetRect.height <= 0) {
      throw captureError({
        code: "E_CAPTURE_EMPTY",
        message: "The verified PDF viewer has no capturable extent.",
        userMessageKey: "errors.captureEmpty",
        causeCode: "EmptyPageNativeTarget",
      });
    }
    const metrics = metricsFromContainer({
      ...initial,
      scrollWidth: targetRect.width,
      scrollHeight: targetRect.height,
    });

    const batchController = new AdaptivePageBatchController({
      documentWidth: targetRect.width,
      documentHeight: targetRect.height,
      viewportWidth: initial.clientWidth,
      viewportHeight: initial.clientHeight,
      pixelScale: Math.max(1, initial.devicePixelRatio),
      overlapCss: this.overlapCss,
      maxTilesPerBatch: Math.max(1, context.settings.limits.maxTiles),
      maxEstimatedBytesPerBatch: Math.max(
        PDF_BATCH_MIN_ESTIMATED_BYTES,
        Math.floor(context.settings.limits.maxEstimatedBytes / 4),
      ),
      maximumPagesPerBatch: PDF_BATCH_MAX_PAGES,
    });

    const allTiles: CaptureTile[] = [];
    let cursor = 0;
    const resume = context.pageNativeResume;
    if (resume !== undefined) {
      if (
        !sameDocumentPageMap(resume.documentPageMap, documentPageMap) ||
        !sameRect(resume.targetRect, targetRect)
      ) {
        throw captureError({
          code: "E_LAYOUT_UNSTABLE",
          message: "The PDF viewer identity or page geometry changed before recovery could resume.",
          userMessageKey: "errors.layoutChanged",
          causeCode: "PdfPageResumeIdentityMismatch",
          retryable: false,
          safeContext: {
            previousPages: resume.documentPageMap.sourcePageCount,
            currentPages: documentPageMap.sourcePageCount,
          },
        });
      }
      while (cursor < documentPageMap.pages.length) {
        const page = documentPageMap.pages[cursor];
        if (page === undefined || !pageCoveredByTiles(page.sourceRectCss, resume.tilePlan)) break;
        cursor += 1;
      }
      const completedRects = documentPageMap.pages
        .slice(0, cursor)
        .map((page) => page.sourceRectCss);
      const ordered = [...resume.tilePlan].sort((left, right) => left.index - right.index);
      for (const tile of ordered) {
        const rect = tile.outputRectCss ?? tile.sourceRectCss;
        if (
          tile.status !== "stored" ||
          !completedRects.some(
            (pageRect) =>
              rect.x >= pageRect.x - RECT_EPSILON_CSS &&
              rect.y >= pageRect.y - RECT_EPSILON_CSS &&
              rect.x + rect.width <= pageRect.x + pageRect.width + RECT_EPSILON_CSS &&
              rect.y + rect.height <= pageRect.y + pageRect.height + RECT_EPSILON_CSS,
          )
        ) {
          break;
        }
        allTiles.push(tile);
      }
      if (allTiles.length < resume.tilePlan.length) {
        await context.discardTilesFromIndex?.(allTiles.length);
      }
    }

    let captureScale: CapturePixelScale | undefined;
    let completedPages = cursor;
    while (cursor < documentPageMap.pages.length) {
      context.cancellation.throwIfCancelled("plan");
      let batch = batchController.nextBatch(documentPageMap.pages, cursor);
      if (batch === undefined) {
        throw captureError({
          code: "E_TILE_PLAN",
          stage: "plan",
          message: "The adaptive PDF page batch controller stopped before the document ended.",
          userMessageKey: "errors.tilePlan",
          causeCode: "PdfPageBatchUnavailable",
          retryable: false,
          safeContext: { cursor, sourcePageCount: documentPageMap.sourcePageCount },
        });
      }

      const firstBatchPage = documentPageMap.pages[batch.startPageIndex];
      if (firstBatchPage === undefined) {
        throw captureError({
          code: "E_TILE_PLAN",
          stage: "plan",
          message: "The first page in the adaptive PDF batch is unavailable.",
          userMessageKey: "errors.tilePlan",
          causeCode: "PdfBatchFirstPageMissing",
          retryable: false,
        });
      }
      const minimumPageBytes = estimatedPageRasterBytes(
        firstBatchPage,
        Math.max(1, initial.devicePixelRatio),
      );
      const pressure = await this.storagePressure.assess(
        batch.estimatedRasterBytes,
        minimumPageBytes,
      );
      if (pressure.pauseRequired) {
        throw storagePauseError(cursor, pressure.availableBytes, minimumPageBytes);
      }
      if (
        pressure.level === "pressure" &&
        pressure.safeBatchBytes !== undefined &&
        pressure.safeBatchBytes < batch.estimatedRasterBytes
      ) {
        batchController.recordOutcome({ durationMs: 0, storedBytes: 0, pressure: true });
        const reduced = batchController.nextBatch(documentPageMap.pages, cursor, {
          maxEstimatedBytesPerBatch: pressure.safeBatchBytes,
        });
        if (
          reduced === undefined ||
          (reduced.pageIndexes.length === 1 &&
            reduced.estimatedRasterBytes > pressure.safeBatchBytes)
        ) {
          throw storagePauseError(cursor, pressure.availableBytes, minimumPageBytes);
        }
        batch = reduced;
      }

      const batchStartedAt = this.nowMs();
      let nextTileIndex = allTiles.length;
      const pagePlans: Array<{ page: DocumentPage; plan: PdfPageCapturePlan }> = [];
      for (const pageIndex of batch.pageIndexes) {
        const page = documentPageMap.pages[pageIndex];
        if (page === undefined) {
          throw captureError({
            code: "E_TILE_PLAN",
            stage: "plan",
            message: "The verified PDF page map changed during page-native planning.",
            userMessageKey: "errors.tilePlan",
            causeCode: "PdfPageMissingDuringPlan",
            retryable: false,
            safeContext: { pageIndex },
          });
        }
        const plan = planPdfPageCaptureTiles({
          jobId: context.jobId,
          pageIndex,
          pageRect: page.sourceRectCss,
          documentWidth: targetRect.width,
          documentHeight: targetRect.height,
          viewportWidth: initial.clientWidth,
          viewportHeight: initial.clientHeight,
          pixelScale: 1,
          overlapCss: this.overlapCss,
          startTileIndex: nextTileIndex,
          maxTilesPerPage: PDF_PAGE_MAX_TILES,
        });
        pagePlans.push({ page, plan });
        nextTileIndex += plan.tileCount;
      }

      const newTiles = pagePlans.flatMap(({ plan }) => plan.tiles);
      await context.onPlan(
        metrics,
        targetRect,
        [...allTiles, ...newTiles],
        undefined,
        documentPageMap,
      );
      allTiles.push(...newTiles);

      let batchStoredBytes = 0;
      for (const { page, plan } of pagePlans) {
        const capturedPageTiles: CaptureTile[] = [];
        for (const planned of plan.tiles) {
          context.cancellation.throwIfCancelled("capture");
          await this.ensureActiveTab(context.tabId, windowId);
          const measurement = await this.pages.scrollAndSettle({
            tabId: context.tabId,
            jobId: context.jobId,
            descriptor,
            scrollLeft: planned.scrollXCss ?? planned.sourceRectCss.x,
            scrollTop: planned.scrollYCss ?? planned.sourceRectCss.y,
            row: planned.row,
            column: planned.column,
            rows: plan.rows,
            columns: plan.columns,
            fixedElementMode: "remove",
            settleMs: context.settings.lazyLoad.settleMs,
            expectedScrollWidth: initial.scrollWidth,
            expectedClientWidth: initial.clientWidth,
            expectedClientHeight: initial.clientHeight,
          });
          this.assertStablePageMeasurement(initial, measurement, planned.index, page.index);

          context.cancellation.throwIfCancelled("capture");
          await this.ensureActiveTab(context.tabId, windowId);
          await context.reportProgress({
            jobId: context.jobId,
            state: "capturing",
            stage: "capturing",
            completed: completedPages,
            total: documentPageMap.sourcePageCount,
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
                userMessageKey: "errors.scrollAreaCapture",
                retryable: true,
                fallbackAllowed: false,
                safeContext: {
                  tabId: context.tabId,
                  tileIndex: planned.index,
                  pageIndex: page.index,
                },
              }),
            );
          }
          const metadata = parsePngDataUrl(dataUrl);
          if (!metadata.ok) throw createWebCapRuntimeError(metadata.error);
          captureScale = validatePixelDimensions(
            {
              width: measurement.viewportWidth,
              height: measurement.viewportHeight,
              devicePixelRatio: measurement.devicePixelRatio,
            },
            metadata.value,
            planned.index,
            captureScale,
          );
          const blob = dataUrlToBlob(dataUrl);
          if (blob.size <= 0) {
            throw captureError({
              code: "E_CAPTURE_EMPTY",
              message: "Page-native PDF capture returned an empty screenshot.",
              userMessageKey: "errors.captureEmpty",
              causeCode: "EmptyPageNativeScreenshot",
              safeContext: { pageIndex: page.index, tileIndex: planned.index },
            });
          }

          const captured: CaptureTile = {
            ...planned,
            captureViewportCss: {
              x: 0,
              y: 0,
              width: measurement.viewportWidth,
              height: measurement.viewportHeight,
            },
            captureCropCss: measurement.captureCropCss,
            expectedPixelWidth: metadata.value.width,
            expectedPixelHeight: metadata.value.height,
            fixedElementsHidden: measurement.hiddenStickyElements,
            status: "stored",
            attempts: 1,
            byteLength: blob.size,
            mimeType: metadata.value.mimeType,
          };
          context.cancellation.throwIfCancelled("capture");
          await context.storeTile(captured, blob);
          batchStoredBytes += blob.size;
          capturedPageTiles.push(captured);
          const position = allTiles.findIndex((candidate) => candidate.index === captured.index);
          if (position >= 0) allTiles[position] = captured;
        }

        const lastCapturedTile = capturedPageTiles.at(-1);
        if (
          lastCapturedTile === undefined ||
          !pageCoveredByTiles(page.sourceRectCss, capturedPageTiles)
        ) {
          throw captureError({
            code: "E_LAYOUT_UNSTABLE",
            message: "A logical PDF page was not fully verified before advancing.",
            userMessageKey: "errors.layoutChanged",
            causeCode: "PdfPageCoverageGap",
            safeContext: { pageIndex: page.index, pageTiles: capturedPageTiles.length },
          });
        }
        completedPages += 1;
        await context.reportProgress({
          jobId: context.jobId,
          state: "capturing",
          stage: "storing",
          completed: completedPages,
          total: documentPageMap.sourcePageCount,
          tileIndex: lastCapturedTile.index,
        });
      }

      batchController.recordOutcome({
        durationMs: Math.max(0, this.nowMs() - batchStartedAt),
        storedBytes: batchStoredBytes,
      });
      cursor = batch.endPageIndexExclusive;
    }

    return {
      metrics,
      targetRect,
      tiles: allTiles,
      documentPageMap,
    };
  }

  async cleanup(context: CaptureEngineContext): Promise<void> {
    const descriptor = context.targetDescriptor;
    if (descriptor === undefined) return;
    const result = await this.pages.cleanup(context.tabId, context.jobId, descriptor);
    if (result.skippedElements > 0 || !result.scrollRestored || !result.documentScrollRestored) {
      throw captureError({
        code: "E_CLEANUP_PARTIAL",
        stage: "cleanup",
        message: "The PDF viewer could not be restored exactly after page-native capture.",
        userMessageKey: "errors.cleanupPartial",
        causeCode: "PageNativeCleanupPartial",
        safeContext: {
          restoredElements: result.restoredElements,
          skippedElements: result.skippedElements,
          scrollRestored: result.scrollRestored,
          documentScrollRestored: result.documentScrollRestored,
        },
      });
    }
  }

  private assertStablePageMeasurement(
    initial: {
      scrollWidth: number;
      clientWidth: number;
      clientHeight: number;
    },
    measurement: Awaited<ReturnType<ScrollAreaPageAdapter["scrollAndSettle"]>>,
    tileIndex: number,
    pageIndex: number,
  ): void {
    if (measurement.scrollSnapped) {
      throw captureError({
        code: "E_LAYOUT_UNSTABLE",
        message: "The PDF viewer changed the requested page-local scroll position.",
        userMessageKey: "errors.scrollSnap",
        causeCode: "PdfPageScrollPositionMismatch",
        safeContext: {
          pageIndex,
          tileIndex,
          requestedX: measurement.requestedScrollLeft,
          requestedY: measurement.requestedScrollTop,
          actualX: measurement.actualScrollLeft,
          actualY: measurement.actualScrollTop,
        },
      });
    }
    const stableGeometry =
      Math.abs(measurement.scrollWidth - initial.scrollWidth) <= 2 &&
      Math.abs(measurement.clientWidth - initial.clientWidth) <= 2 &&
      Math.abs(measurement.clientHeight - initial.clientHeight) <= 2;
    if (measurement.layoutChanged || !stableGeometry || measurement.stableSamples < 1) {
      throw captureError({
        code: "E_LAYOUT_UNSTABLE",
        message: "The logical PDF page did not settle to stable capture geometry.",
        userMessageKey: "errors.layoutChanged",
        causeCode: "PdfPageNotStable",
        safeContext: {
          pageIndex,
          tileIndex,
          stableSamples: measurement.stableSamples,
          scrollWidth: measurement.scrollWidth,
          clientWidth: measurement.clientWidth,
          clientHeight: measurement.clientHeight,
        },
      });
    }
  }

  private async ensureActiveTab(tabId: number, windowId: number): Promise<void> {
    const active = await this.tabs.queryActiveTab();
    if (active?.id !== tabId || active.windowId !== windowId || !active.active) {
      throw captureError({
        code: "E_TAB_NOT_ACTIVE",
        message: "Page-native PDF capture requires the source tab to remain active.",
        userMessageKey: "errors.tabNotActive",
        causeCode: "PageNativeTabNotActive",
        safeContext: { tabId, windowId },
      });
    }
  }
}
