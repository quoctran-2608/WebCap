import { describe, expect, it, vi } from "vitest";

import { CaptureRateLimiter } from "@background/capture-rate-limiter";
import type {
  ScrollAreaPageAdapter,
  ScrollAreaPageRequest,
  ScrollAreaPageResult,
} from "@background/scroll-area-page-adapter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import type { CaptureEngineContext } from "@capture/capture-engine";
import { ScrollAreaCaptureEngine } from "@capture/scroll-area-capture-engine";
import type { CaptureTile } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const HUNDRED_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAnklEQVR42u3QMQEAAAgDILV/51nBzwci0CmuRoEsWbJkyZKlQJYsWbJkyVIgS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWd8Wil4Bx2r6t7cAAAAASUVORK5CYII=";
const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "scroll-selection",
  tagName: "section",
  classNames: ["messages"],
  scrollable: true,
  captureKind: "full-scroll-content" as const,
};

function pageResult(request: ScrollAreaPageRequest): ScrollAreaPageResult {
  return {
    requestedScrollLeft: request.scrollLeft,
    requestedScrollTop: request.scrollTop,
    actualScrollLeft: request.scrollLeft,
    actualScrollTop: request.scrollTop,
    scrollWidth: 100,
    scrollHeight: 220,
    clientWidth: 100,
    clientHeight: 100,
    viewportWidth: 100,
    viewportHeight: 100,
    devicePixelRatio: 1,
    captureCropCss: { x: 0, y: 0, width: 100, height: 100 },
    hiddenStickyElements: request.row > 0 ? 1 : 0,
    stableSamples: 1,
    mutationCount: 0,
    scrollSnapped: false,
    layoutChanged: false,
  };
}

function setup(
  createPageResult: (request: ScrollAreaPageRequest) => ScrollAreaPageResult = pageResult,
) {
  const scrollAndSettle = vi.fn((request: ScrollAreaPageRequest) =>
    Promise.resolve(createPageResult(request)),
  );
  const cleanup = vi.fn(() =>
    Promise.resolve({
      restoredElements: 2,
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
  const engine = new ScrollAreaCaptureEngine({
    pages,
    tabs,
    overlapCss: 20,
    limiter: new CaptureRateLimiter({
      minimumIntervalMs: 0,
      now: () => 1,
      sleep: () => Promise.resolve(),
    }),
  });
  const stored: CaptureTile[] = [];
  const onPlan = vi.fn(() => Promise.resolve());
  const context: CaptureEngineContext = {
    jobId: "job-scroll-area",
    tabId: 7,
    windowId: 3,
    settings: {
      ...DEFAULT_CAPTURE_SETTINGS,
      lazyLoad: { ...DEFAULT_CAPTURE_SETTINGS.lazyLoad, settleMs: 0 },
    },
    targetRect: { x: 0, y: 0, width: 100, height: 220 },
    targetDescriptor: descriptor,
    cancellation: { cancelled: false, keepPartial: false, throwIfCancelled: () => undefined },
    onPlan,
    storeTile(tile) {
      stored.push(tile);
      return Promise.resolve();
    },
    reportProgress: () => undefined,
  };
  return { engine, context, stored, scrollAndSettle, cleanup, onPlan };
}

describe("ScrollAreaCaptureEngine", () => {
  it("captures the full internal scroll surface with viewport crop metadata", async () => {
    const harness = setup();

    const result = await harness.engine.capture(harness.context);

    expect(result.tiles).toHaveLength(3);
    expect(harness.scrollAndSettle).toHaveBeenCalledTimes(4);
    expect(harness.onPlan).toHaveBeenCalledOnce();
    expect(harness.stored.map((tile) => tile.outputRectCss)).toEqual([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 100, width: 100, height: 80 },
      { x: 0, y: 180, width: 100, height: 40 },
    ]);
    expect(
      harness.stored.every(
        (tile) =>
          tile.captureViewportCss?.width === 100 &&
          tile.captureCropCss?.width === 100 &&
          tile.expectedPixelWidth === 100 &&
          tile.status === "stored",
      ),
    ).toBe(true);
  });

  it("starts internal scrolling instead of failing at the legacy CSS-height limit", async () => {
    const harness = setup();
    harness.context.settings = {
      ...harness.context.settings,
      limits: { ...harness.context.settings.limits, maxCssHeight: 200 },
    };

    const result = await harness.engine.capture(harness.context);

    expect(result.tiles).toHaveLength(3);
    expect(result.targetRect).toEqual({ x: 0, y: 0, width: 100, height: 220 });
    expect(result.partialCapture).toBeUndefined();
    expect(harness.scrollAndSettle).toHaveBeenCalledTimes(4);
    expect(harness.stored.map((tile) => tile.scrollYCss)).toEqual([0, 80, 120]);
  });

  it("continues when a PDF-like viewer changes only its internal scroll height", async () => {
    let calls = 0;
    const harness = setup((request) => {
      const result = pageResult(request);
      calls += 1;
      if (calls > 1) {
        result.scrollHeight = 244;
        result.mutationCount = 3;
        result.layoutChanged =
          request.expectedScrollHeight !== undefined &&
          Math.abs(result.scrollHeight - request.expectedScrollHeight) > 2;
      }
      return result;
    });

    const result = await harness.engine.capture(harness.context);

    expect(result.tiles).toHaveLength(3);
    expect(harness.stored).toHaveLength(3);
    expect(
      harness.scrollAndSettle.mock.calls
        .slice(1)
        .every(([request]) => request.expectedScrollHeight === undefined),
    ).toBe(true);
  });

  it("retries a transient viewport geometry change before capturing the tile", async () => {
    let transientChangePending = true;
    const harness = setup((request) => {
      const result = pageResult(request);
      if (request.expectedScrollWidth !== undefined && transientChangePending) {
        transientChangePending = false;
        result.scrollWidth = 104;
        result.layoutChanged = true;
      }
      return result;
    });

    const result = await harness.engine.capture(harness.context);

    expect(result.tiles).toHaveLength(3);
    expect(harness.scrollAndSettle).toHaveBeenCalledTimes(5);
    expect(harness.stored).toHaveLength(3);
  });

  it("still rejects a persistent viewport geometry change", async () => {
    const harness = setup((request) => {
      const result = pageResult(request);
      if (request.expectedScrollWidth !== undefined) {
        result.scrollWidth = 110;
        result.layoutChanged = true;
      }
      return result;
    });

    await expect(harness.engine.capture(harness.context)).rejects.toMatchObject({
      data: {
        code: "E_LAYOUT_UNSTABLE",
        causeCode: "ScrollAreaViewportGeometryChanged",
      },
    });
    expect(harness.stored).toEqual([]);
  });

  it("keeps a contiguous prefix and marks max-tiles instead of failing", async () => {
    const harness = setup();
    harness.context.settings = {
      ...harness.context.settings,
      limits: { ...harness.context.settings.limits, maxTiles: 2 },
    };

    const result = await harness.engine.capture(harness.context);

    expect(result.tiles).toHaveLength(2);
    expect(result.targetRect).toEqual({ x: 0, y: 0, width: 100, height: 180 });
    expect(result.partialCapture).toEqual({
      reason: "max-tiles",
      capturedRect: { x: 0, y: 0, width: 100, height: 180 },
      limitValue: 2,
    });
    expect(harness.scrollAndSettle).toHaveBeenCalledTimes(3);
    expect(harness.onPlan).toHaveBeenCalledWith(
      expect.any(Object),
      { x: 0, y: 0, width: 100, height: 180 },
      expect.arrayContaining([
        expect.objectContaining({ index: 0 }),
        expect.objectContaining({ index: 1 }),
      ]),
      result.partialCapture,
    );
  });

  it("restores the container and document scroll state", async () => {
    const harness = setup();

    await expect(harness.engine.cleanup?.(harness.context)).resolves.toBeUndefined();
    expect(harness.cleanup).toHaveBeenCalledWith(7, "job-scroll-area", descriptor);
  });
});
