import { describe, expect, it, vi } from "vitest";

import { CaptureRateLimiter } from "@background/capture-rate-limiter";
import type {
  ScrollAreaPageAdapter,
  ScrollAreaPageRequest,
  ScrollAreaPageResult,
} from "@background/scroll-area-page-adapter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import type { CaptureEngine, CaptureEngineContext } from "@capture/capture-engine";
import { PageNativeCaptureEngine } from "@capture/page-native-capture-engine";
import type { CaptureTile, DocumentPageMap } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const HUNDRED_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAnklEQVR42u3QMQEAAAgDILV/51nBzwci0CmuRoEsWbJkyZKlQJYsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YCWbJkyZIlS4EsWd8Wil4Bx2r6t7cAAAAASUVORK5CYII=";

const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "pdf-selection",
  tagName: "section",
  classNames: ["pdf-viewer"],
  scrollable: true,
  captureKind: "full-scroll-content" as const,
};

const pageMap: DocumentPageMap = {
  schemaVersion: 1,
  strategy: "dom",
  confidence: 1,
  complete: true,
  sourcePageCount: 3,
  pages: [
    { index: 0, sourceRectCss: { x: 10, y: 0, width: 80, height: 90 } },
    { index: 1, sourceRectCss: { x: 5, y: 100, width: 90, height: 70 } },
    { index: 2, sourceRectCss: { x: 10, y: 180, width: 80, height: 90 } },
  ],
};

function pageResult(request: ScrollAreaPageRequest, includeMap = false): ScrollAreaPageResult {
  return {
    requestedScrollLeft: request.scrollLeft,
    requestedScrollTop: request.scrollTop,
    actualScrollLeft: request.scrollLeft,
    actualScrollTop: request.scrollTop,
    scrollWidth: 100,
    scrollHeight: 270,
    clientWidth: 100,
    clientHeight: 100,
    viewportWidth: 100,
    viewportHeight: 100,
    devicePixelRatio: 1,
    captureCropCss: { x: 0, y: 0, width: 100, height: 100 },
    hiddenStickyElements: request.fixedElementMode === "remove" ? 1 : 0,
    stableSamples: 2,
    mutationCount: 0,
    scrollSnapped: false,
    layoutChanged: false,
    ...(includeMap ? { documentPageMap: pageMap } : {}),
  };
}

function setup(options: { discover?: boolean } = {}) {
  const scrollAndSettle = vi.fn((request: ScrollAreaPageRequest) =>
    Promise.resolve(
      pageResult(
        request,
        options.discover !== false && request.expectedScrollWidth === undefined,
      ),
    ),
  );
  const cleanup = vi.fn(() =>
    Promise.resolve({
      restoredElements: 1,
      skippedElements: 0,
      scrollRestored: true,
      documentScrollRestored: true,
    }),
  );
  const pages: ScrollAreaPageAdapter = { scrollAndSettle, cleanup };
  const tabs: TabsCaptureAdapter = {
    queryActiveTab: () => Promise.resolve({ id: 7, windowId: 3, active: true }),
    captureVisibleTab: vi.fn(() => Promise.resolve(HUNDRED_PIXEL_PNG)),
  };
  const fallbackCapture = vi.fn(async (context: CaptureEngineContext) => ({
    metrics: {
      document: { x: 0, y: 0, width: 100, height: 270 },
      layoutViewport: { x: 0, y: 0, width: 100, height: 100 },
      visualViewport: { x: 0, y: 0, width: 100, height: 100, scale: 1 },
      devicePixelRatio: 1,
      zoomFactor: 1,
      scrollX: 0,
      scrollY: 0,
    },
    targetRect: context.targetRect ?? { x: 0, y: 0, width: 100, height: 270 },
    tiles: [],
  }));
  const fallback: CaptureEngine = { kind: "scroll", capture: fallbackCapture };
  const engine = new PageNativeCaptureEngine({
    pages,
    tabs,
    fallback,
    overlapCss: 20,
    limiter: new CaptureRateLimiter({
      minimumIntervalMs: 0,
      now: () => 1,
      sleep: () => Promise.resolve(),
    }),
    nowMs: (() => {
      let now = 0;
      return () => (now += 100);
    })(),
  });
  const stored: CaptureTile[] = [];
  const plans: CaptureTile[][] = [];
  const context: CaptureEngineContext = {
    jobId: "job-page-native",
    tabId: 7,
    windowId: 3,
    settings: {
      ...DEFAULT_CAPTURE_SETTINGS,
      lazyLoad: { ...DEFAULT_CAPTURE_SETTINGS.lazyLoad, settleMs: 0 },
      limits: { ...DEFAULT_CAPTURE_SETTINGS.limits, maxTiles: 1 },
    },
    targetRect: { x: 0, y: 0, width: 100, height: 270 },
    targetDescriptor: descriptor,
    cancellation: { cancelled: false, keepPartial: false, throwIfCancelled: () => undefined },
    onPlan(_metrics, _targetRect, tiles) {
      plans.push(structuredClone(tiles));
      return Promise.resolve();
    },
    storeTile(tile) {
      stored.push(tile);
      return Promise.resolve();
    },
    reportProgress: () => undefined,
  };
  return { engine, context, stored, plans, scrollAndSettle, cleanup, fallbackCapture };
}

describe("PageNativeCaptureEngine", () => {
  it("captures verified logical pages through multiple batches without a document-wide maxTiles cap", async () => {
    const harness = setup();

    const result = await harness.engine.capture(harness.context);

    expect(result.documentPageMap).toEqual(pageMap);
    expect(result.tiles).toHaveLength(3);
    expect(harness.stored).toHaveLength(3);
    expect(harness.plans).toHaveLength(3);
    expect(harness.plans.map((plan) => plan.length)).toEqual([1, 2, 3]);
    expect(harness.plans[1]?.[0]?.status).toBe("stored");
    expect(harness.plans[2]?.slice(0, 2).every((tile) => tile.status === "stored")).toBe(true);
    expect(harness.fallbackCapture).not.toHaveBeenCalled();
    expect(harness.scrollAndSettle).toHaveBeenCalledTimes(4);
    expect(
      harness.scrollAndSettle.mock.calls.slice(1).every(([request]) => request.fixedElementMode === "remove"),
    ).toBe(true);
  });

  it("delegates ordinary scroll areas to the existing generic engine", async () => {
    const harness = setup({ discover: false });

    const result = await harness.engine.capture(harness.context);

    expect(harness.fallbackCapture).toHaveBeenCalledOnce();
    expect(result.documentPageMap).toBeUndefined();
    expect(harness.stored).toHaveLength(0);
  });

  it("fails before storing a page when its settled geometry is unstable", async () => {
    const harness = setup();
    harness.scrollAndSettle.mockImplementation((request: ScrollAreaPageRequest) =>
      Promise.resolve({
        ...pageResult(request, request.expectedScrollWidth === undefined),
        ...(request.expectedScrollWidth === undefined ? {} : { stableSamples: 1 }),
      }),
    );

    await expect(harness.engine.capture(harness.context)).rejects.toMatchObject({
      data: { code: "E_LAYOUT_UNSTABLE", causeCode: "PdfPageNotStable" },
    });
    expect(harness.stored).toHaveLength(0);
  });

  it("restores the viewer through the same scroll-area cleanup contract", async () => {
    const harness = setup();

    await expect(harness.engine.cleanup?.(harness.context)).resolves.toBeUndefined();
    expect(harness.cleanup).toHaveBeenCalledWith(7, "job-page-native", descriptor);
  });
});
