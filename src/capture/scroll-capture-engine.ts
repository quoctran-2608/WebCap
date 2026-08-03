import { CaptureRateLimiter } from "@background/capture-rate-limiter";
import { dataUrlToBlob } from "@background/data-url";
import { parsePngDataUrl } from "@background/png-metadata";
import type { ScrollCapturePageAdapter } from "@background/scroll-capture-page-adapter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import type {
  CaptureEngine,
  CaptureEngineContext,
  CaptureEngineResult,
} from "@capture/capture-engine";
import { planScrollCaptureTiles } from "@capture/overlap-resolver";
import { FALLBACK_OVERLAP_CSS, VISIBLE_CAPTURE_MIN_INTERVAL_MS } from "@shared/constants";
import type { CaptureTile, PageMetrics, Rect } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";

export interface ScrollCaptureEngineOptions {
  pages: ScrollCapturePageAdapter;
  tabs: TabsCaptureAdapter;
  limiter?: CaptureRateLimiter;
  overlapCss?: number;
}

function captureError(options: {
  code: "E_PROTOCOL_MESSAGE" | "E_TAB_NOT_ACTIVE" | "E_LAYOUT_UNSTABLE" | "E_CAPTURE_EMPTY";
  message: string;
  userMessageKey: string;
  causeCode: string;
  retryable?: boolean;
  safeContext?: Record<string, string | number | boolean>;
}): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: options.code,
      stage: "capture",
      message: options.message,
      userMessageKey: options.userMessageKey,
      retryable: options.retryable ?? true,
      fallbackAllowed: false,
      causeCode: options.causeCode,
      ...(options.safeContext === undefined ? {} : { safeContext: options.safeContext }),
    }),
  );
}

function boundedTarget(documentRect: Rect, context: CaptureEngineContext): Rect {
  const requested = context.targetRect ?? documentRect;
  const maximumRight =
    documentRect.x + Math.min(documentRect.width, context.settings.limits.maxCssWidth);
  const maximumBottom =
    documentRect.y + Math.min(documentRect.height, context.settings.limits.maxCssHeight);
  const x = Math.max(documentRect.x, requested.x);
  const y = Math.max(documentRect.y, requested.y);
  const target = {
    x,
    y,
    width: Math.max(0, Math.min(requested.x + requested.width, maximumRight) - x),
    height: Math.max(0, Math.min(requested.y + requested.height, maximumBottom) - y),
  };
  if (target.width <= 0 || target.height <= 0) {
    throw captureError({
      code: "E_PROTOCOL_MESSAGE",
      message: "The scroll fallback target is empty after document clamping.",
      userMessageKey: "errors.captureTarget",
      causeCode: "EmptyScrollTarget",
      retryable: false,
    });
  }
  return target;
}

function metricsFromPage(result: {
  documentWidth: number;
  documentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  actualScrollX: number;
  actualScrollY: number;
}): PageMetrics {
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
  page: { viewportWidth: number; viewportHeight: number; devicePixelRatio: number },
  actual: { width: number; height: number },
  tileIndex: number,
  expectedScale: number | undefined,
): number {
  const scaleX = actual.width / page.viewportWidth;
  const scaleY = actual.height / page.viewportHeight;
  const calibratedScale = (scaleX + scaleY) / 2;
  const axisTolerance = 0.02;
  const minimumScale = 0.25;
  const maximumScale = 8;
  const dimensionsAreCoherent =
    Number.isFinite(scaleX) &&
    Number.isFinite(scaleY) &&
    calibratedScale >= minimumScale &&
    calibratedScale <= maximumScale &&
    Math.abs(scaleX - scaleY) <= axisTolerance;

  if (dimensionsAreCoherent && expectedScale === undefined) {
    return calibratedScale;
  }

  const stableScale = expectedScale ?? calibratedScale;
  const expectedWidth = Math.max(1, Math.round(page.viewportWidth * stableScale));
  const expectedHeight = Math.max(1, Math.round(page.viewportHeight * stableScale));
  const pixelTolerance = 2;
  if (
    dimensionsAreCoherent &&
    Math.abs(actual.width - expectedWidth) <= pixelTolerance &&
    Math.abs(actual.height - expectedHeight) <= pixelTolerance
  ) {
    return stableScale;
  }

  throw captureError({
    code: "E_LAYOUT_UNSTABLE",
    message: "The visible screenshot pixel scale changed or did not match the viewport axes.",
    userMessageKey: "errors.pixelScaleMismatch",
    causeCode: "FallbackPixelScaleMismatch",
    safeContext: {
      tileIndex,
      viewportWidth: page.viewportWidth,
      viewportHeight: page.viewportHeight,
      actualWidth: actual.width,
      actualHeight: actual.height,
      scaleX,
      scaleY,
      expectedScale: stableScale,
      devicePixelRatio: page.devicePixelRatio,
    },
  });
}

export class ScrollCaptureEngine implements CaptureEngine {
  readonly kind = "scroll" as const;
  private readonly pages: ScrollCapturePageAdapter;
  private readonly tabs: TabsCaptureAdapter;
  private readonly limiter: CaptureRateLimiter;
  private readonly overlapCss: number;

  constructor(options: ScrollCaptureEngineOptions) {
    this.pages = options.pages;
    this.tabs = options.tabs;
    this.limiter =
      options.limiter ??
      new CaptureRateLimiter({ minimumIntervalMs: VISIBLE_CAPTURE_MIN_INTERVAL_MS });
    this.overlapCss = options.overlapCss ?? FALLBACK_OVERLAP_CSS;
  }

  async capture(context: CaptureEngineContext): Promise<CaptureEngineResult> {
    const preparation = context.preparation;
    const windowId = context.windowId;
    if (preparation === undefined || windowId === undefined) {
      throw captureError({
        code: "E_PROTOCOL_MESSAGE",
        message: "Scroll fallback requires prepared-page and window context.",
        userMessageKey: "errors.scrollCaptureContext",
        causeCode: "MissingScrollCaptureContext",
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
      preparationId: context.jobId,
      scrollX: preparation.preparedScroll.x,
      scrollY: preparation.preparedScroll.y,
      tileIndex: 0,
      totalTiles: 1,
      fixedElementMode: "preserve",
      settleMs: context.settings.lazyLoad.settleMs,
      expectedDocumentWidth: preparation.documentWidth,
      expectedDocumentHeight: preparation.documentHeight,
    });
    const metrics = metricsFromPage(initial);
    const targetRect = boundedTarget(metrics.document, context);

    context.cancellation.throwIfCancelled("plan");
    await context.reportProgress({
      jobId: context.jobId,
      state: "preparing",
      stage: "planning",
      completed: 0,
      total: 0,
    });
    const plan = planScrollCaptureTiles({
      jobId: context.jobId,
      targetRect,
      viewportWidthCss: initial.viewportWidth,
      viewportHeightCss: initial.viewportHeight,
      pixelScale: 1,
      overlapCss: this.overlapCss,
      maxTiles: context.settings.limits.maxTiles,
    });
    await context.onPlan(metrics, plan.targetRect, plan.tiles);

    const storedTiles: CaptureTile[] = [];
    let captureScale: number | undefined;
    for (const planned of plan.tiles) {
      context.cancellation.throwIfCancelled("capture");
      await this.ensureActiveTab(context.tabId, windowId);
      await context.reportProgress({
        jobId: context.jobId,
        state: "capturing",
        stage: "scrolling",
        completed: storedTiles.length,
        total: plan.tiles.length,
        tileIndex: planned.index,
      });
      const page = await this.pages.scrollAndSettle({
        tabId: context.tabId,
        preparationId: context.jobId,
        scrollX: planned.scrollXCss ?? planned.sourceRectCss.x,
        scrollY: planned.scrollYCss ?? planned.sourceRectCss.y,
        tileIndex: planned.index,
        totalTiles: plan.tiles.length,
        fixedElementMode: context.settings.fixedElementMode,
        settleMs: context.settings.lazyLoad.settleMs,
        expectedDocumentWidth: metrics.document.width,
        expectedDocumentHeight: metrics.document.height,
      });
      if (page.scrollSnapped) {
        throw captureError({
          code: "E_LAYOUT_UNSTABLE",
          message: "The page changed the requested fallback scroll position.",
          userMessageKey: "errors.scrollSnap",
          causeCode: "ScrollPositionMismatch",
          safeContext: {
            tileIndex: planned.index,
            requestedX: planned.scrollXCss ?? planned.sourceRectCss.x,
            requestedY: planned.scrollYCss ?? planned.sourceRectCss.y,
            actualX: page.actualScrollX,
            actualY: page.actualScrollY,
          },
        });
      }
      if (page.layoutChanged) {
        throw captureError({
          code: "E_LAYOUT_UNSTABLE",
          message: "The page dimensions changed during scroll fallback capture.",
          userMessageKey: "errors.layoutChanged",
          causeCode: "FallbackLayoutChanged",
          safeContext: {
            tileIndex: planned.index,
            documentWidth: page.documentWidth,
            documentHeight: page.documentHeight,
          },
        });
      }

      context.cancellation.throwIfCancelled("capture");
      await this.ensureActiveTab(context.tabId, windowId);
      await context.reportProgress({
        jobId: context.jobId,
        state: "capturing",
        stage: "capturing",
        completed: storedTiles.length,
        total: plan.tiles.length,
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
          message: "Scroll fallback returned an empty screenshot.",
          userMessageKey: "errors.captureEmpty",
          causeCode: "EmptyVisibleCapture",
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
        attempts: 1,
        byteLength: blob.size,
        mimeType: metadata.value.mimeType,
      };
      context.cancellation.throwIfCancelled("capture");
      await context.reportProgress({
        jobId: context.jobId,
        state: "capturing",
        stage: "storing",
        completed: storedTiles.length,
        total: plan.tiles.length,
        tileIndex: planned.index,
      });
      await context.storeTile(captured, blob);
      storedTiles.push(captured);
    }

    return { metrics, targetRect: plan.targetRect, tiles: storedTiles };
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
          message: "Some scroll fallback fixed-element changes were modified by the page.",
          userMessageKey: "errors.cleanupPartial",
          retryable: true,
          fallbackAllowed: false,
          causeCode: "ScrollMutationChanged",
          safeContext: {
            tabId: context.tabId,
            restoredElements: result.restoredElements,
            skippedElements: result.skippedElements,
          },
        }),
      );
    }
  }

  private async ensureActiveTab(tabId: number, windowId: number): Promise<void> {
    const active = await this.tabs.queryActiveTab();
    if (active?.id !== tabId || active.windowId !== windowId || !active.active) {
      throw captureError({
        code: "E_TAB_NOT_ACTIVE",
        message: "Scroll fallback requires the source tab to remain active.",
        userMessageKey: "errors.tabNotActive",
        causeCode: "FallbackTabNotActive",
        safeContext: { tabId, windowId },
      });
    }
  }
}
