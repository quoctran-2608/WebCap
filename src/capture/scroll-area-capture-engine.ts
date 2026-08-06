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
import { planScrollCaptureTiles } from "@capture/overlap-resolver";
import { FALLBACK_OVERLAP_CSS, VISIBLE_CAPTURE_MIN_INTERVAL_MS } from "@shared/constants";
import type { CaptureTile, PageMetrics } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";

export interface ScrollAreaCaptureEngineOptions {
  pages: ScrollAreaPageAdapter;
  tabs: TabsCaptureAdapter;
  limiter?: CaptureRateLimiter;
  overlapCss?: number;
}

interface CapturePixelScale {
  x: number;
  y: number;
}

function captureError(options: {
  code:
    | "E_PROTOCOL_MESSAGE"
    | "E_TAB_NOT_ACTIVE"
    | "E_LAYOUT_UNSTABLE"
    | "E_CAPTURE_EMPTY"
    | "E_CLEANUP_PARTIAL";
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
    message: "The visible screenshot scale changed during scrollable-area capture.",
    userMessageKey: "errors.pixelScaleMismatch",
    causeCode: "ScrollAreaPixelScaleMismatch",
    safeContext: {
      tileIndex,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
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

export class ScrollAreaCaptureEngine implements CaptureEngine {
  readonly kind = "scroll" as const;
  private readonly pages: ScrollAreaPageAdapter;
  private readonly tabs: TabsCaptureAdapter;
  private readonly limiter: CaptureRateLimiter;
  private readonly overlapCss: number;

  constructor(options: ScrollAreaCaptureEngineOptions) {
    this.pages = options.pages;
    this.tabs = options.tabs;
    this.limiter =
      options.limiter ??
      new CaptureRateLimiter({ minimumIntervalMs: VISIBLE_CAPTURE_MIN_INTERVAL_MS });
    this.overlapCss = options.overlapCss ?? FALLBACK_OVERLAP_CSS;
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
        message: "Scrollable-area capture requires an opaque scroll-container target.",
        userMessageKey: "errors.scrollAreaCapture",
        causeCode: "MissingScrollAreaContext",
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
    const targetRect = {
      x: 0,
      y: 0,
      width: initial.scrollWidth,
      height: initial.scrollHeight,
    };
    if (targetRect.width <= 0 || targetRect.height <= 0) {
      throw captureError({
        code: "E_CAPTURE_EMPTY",
        message: "The selected scrollable container has no capturable content.",
        userMessageKey: "errors.captureEmpty",
        causeCode: "EmptyScrollAreaTarget",
      });
    }
    const metrics = metricsFromContainer(initial);

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
      viewportWidthCss: initial.clientWidth,
      viewportHeightCss: initial.clientHeight,
      pixelScale: 1,
      overlapCss: this.overlapCss,
      maxTiles: context.settings.limits.maxTiles,
    });
    const partialCapture = plan.limitedByMaxTiles
      ? {
          reason: "max-tiles" as const,
          capturedRect: plan.targetRect,
          limitValue: context.settings.limits.maxTiles,
        }
      : undefined;
    await context.onPlan(metrics, plan.targetRect, plan.tiles, partialCapture);

    const storedTiles: CaptureTile[] = [];
    let captureScale: CapturePixelScale | undefined;
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
        jobId: context.jobId,
        descriptor,
        scrollLeft: planned.scrollXCss ?? planned.sourceRectCss.x,
        scrollTop: planned.scrollYCss ?? planned.sourceRectCss.y,
        row: planned.row,
        column: planned.column,
        rows: plan.rows,
        columns: plan.columns,
        fixedElementMode: context.settings.fixedElementMode,
        settleMs: context.settings.lazyLoad.settleMs,
        expectedScrollWidth: initial.scrollWidth,
        expectedScrollHeight: initial.scrollHeight,
        expectedClientWidth: initial.clientWidth,
        expectedClientHeight: initial.clientHeight,
      });
      if (page.scrollSnapped) {
        throw captureError({
          code: "E_LAYOUT_UNSTABLE",
          message: "The container changed the requested internal scroll position.",
          userMessageKey: "errors.scrollSnap",
          causeCode: "ScrollAreaPositionMismatch",
          safeContext: {
            tileIndex: planned.index,
            requestedX: planned.scrollXCss ?? planned.sourceRectCss.x,
            requestedY: planned.scrollYCss ?? planned.sourceRectCss.y,
            actualX: page.actualScrollLeft,
            actualY: page.actualScrollTop,
          },
        });
      }
      if (page.layoutChanged) {
        throw captureError({
          code: "E_LAYOUT_UNSTABLE",
          message: "The selected container dimensions changed during capture.",
          userMessageKey: "errors.layoutChanged",
          causeCode: "ScrollAreaLayoutChanged",
          safeContext: {
            tileIndex: planned.index,
            scrollWidth: page.scrollWidth,
            scrollHeight: page.scrollHeight,
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
            userMessageKey: "errors.scrollAreaCapture",
            retryable: true,
            fallbackAllowed: false,
            safeContext: { tabId: context.tabId, tileIndex: planned.index },
          }),
        );
      }
      const metadata = parsePngDataUrl(dataUrl);
      if (!metadata.ok) throw createWebCapRuntimeError(metadata.error);
      captureScale = validatePixelDimensions(
        {
          width: page.viewportWidth,
          height: page.viewportHeight,
          devicePixelRatio: page.devicePixelRatio,
        },
        metadata.value,
        planned.index,
        captureScale,
      );
      const blob = dataUrlToBlob(dataUrl);
      if (blob.size <= 0) {
        throw captureError({
          code: "E_CAPTURE_EMPTY",
          message: "Scrollable-area capture returned an empty screenshot.",
          userMessageKey: "errors.captureEmpty",
          causeCode: "EmptyScrollAreaScreenshot",
          safeContext: { tileIndex: planned.index },
        });
      }

      const captured: CaptureTile = {
        ...planned,
        captureViewportCss: {
          x: 0,
          y: 0,
          width: page.viewportWidth,
          height: page.viewportHeight,
        },
        captureCropCss: page.captureCropCss,
        expectedPixelWidth: metadata.value.width,
        expectedPixelHeight: metadata.value.height,
        fixedElementsHidden: page.hiddenStickyElements,
        status: "stored",
        attempts: 1,
        byteLength: blob.size,
        mimeType: metadata.value.mimeType,
      };
      await context.reportProgress({
        jobId: context.jobId,
        state: "capturing",
        stage: "storing",
        completed: storedTiles.length,
        total: plan.tiles.length,
        tileIndex: planned.index,
      });
      context.cancellation.throwIfCancelled("capture");
      await context.storeTile(captured, blob);
      storedTiles.push(captured);
    }

    return {
      metrics,
      targetRect: plan.targetRect,
      tiles: storedTiles,
      ...(partialCapture === undefined ? {} : { partialCapture }),
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
        message: "The scrollable container could not be restored exactly after capture.",
        userMessageKey: "errors.cleanupPartial",
        causeCode: "ScrollAreaCleanupPartial",
        safeContext: {
          restoredElements: result.restoredElements,
          skippedElements: result.skippedElements,
          scrollRestored: result.scrollRestored,
          documentScrollRestored: result.documentScrollRestored,
        },
      });
    }
  }

  private async ensureActiveTab(tabId: number, windowId: number): Promise<void> {
    const active = await this.tabs.queryActiveTab();
    if (active?.id !== tabId || active.windowId !== windowId || !active.active) {
      throw captureError({
        code: "E_TAB_NOT_ACTIVE",
        message: "Scrollable-area capture requires the source tab to remain active.",
        userMessageKey: "errors.tabNotActive",
        causeCode: "ScrollAreaTabNotActive",
        safeContext: { tabId, windowId },
      });
    }
  }
}
