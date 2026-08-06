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
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAnklEQVR42u3QMQEAAAgDILV/51nBzwci0CmuRoEsWbJkyZKlQJYsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWbJkyVIgS5YsWbJkKZAlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWd8Wil4Bx2r6t7cAAAAASUVORK5CYII=";

const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "long-pdf-scroll-selection",
  tagName: "embed",
  classNames: ["pdf-viewer"],
  scrollable: true,
  captureKind: "full-scroll-content" as const,
};

function pageResult(request: ScrollAreaPageRequest, scrollHeight: number): ScrollAreaPageResult {
  return {
    requestedScrollLeft: request.scrollLeft,
    requestedScrollTop: request.scrollTop,
    actualScrollLeft: request.scrollLeft,
    actualScrollTop: request.scrollTop,
    scrollWidth: 100,
    scrollHeight,
    clientWidth: 100,
    clientHeight: 100,
    viewportWidth: 100,
    viewportHeight: 100,
    devicePixelRatio: 1,
    captureCropCss: { x: 0, y: 0, width: 100, height: 100 },
    hiddenStickyElements: 0,
    stableSamples: 2,
    mutationCount: scrollHeight > 20_500 ? 4 : 0,
    scrollSnapped: false,
    layoutChanged:
      request.expectedScrollHeight !== undefined &&
      Math.abs(scrollHeight - request.expectedScrollHeight) > 2,
  };
}

describe("ScrollAreaCaptureEngine long PDF regression", () => {
  it(
    "finishes 256 tiles when lazy PDF height drifts after tile 115",
    async () => {
      let calls = 0;
      const scrollAndSettle = vi.fn((request: ScrollAreaPageRequest) => {
        calls += 1;
        const scrollHeight = calls > 116 ? 20_524 : 20_500;
        return Promise.resolve(pageResult(request, scrollHeight));
      });
      const pages: ScrollAreaPageAdapter = {
        scrollAndSettle,
        cleanup: () =>
          Promise.resolve({
            restoredElements: 0,
            skippedElements: 0,
            scrollRestored: true,
            documentScrollRestored: true,
          }),
      };
      const tabs: TabsCaptureAdapter = {
        queryActiveTab: () => Promise.resolve({ id: 7, windowId: 3, active: true }),
        captureVisibleTab: () => Promise.resolve(HUNDRED_PIXEL_PNG),
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
        jobId: "job-long-pdf",
        tabId: 7,
        windowId: 3,
        settings: {
          ...DEFAULT_CAPTURE_SETTINGS,
          lazyLoad: { ...DEFAULT_CAPTURE_SETTINGS.lazyLoad, settleMs: 0 },
          limits: { ...DEFAULT_CAPTURE_SETTINGS.limits, maxTiles: 256 },
        },
        targetRect: { x: 0, y: 0, width: 100, height: 20_500 },
        targetDescriptor: descriptor,
        cancellation: {
          cancelled: false,
          keepPartial: false,
          throwIfCancelled: () => undefined,
        },
        onPlan,
        storeTile(tile) {
          stored.push(tile);
          return Promise.resolve();
        },
        reportProgress: () => undefined,
      };

      const result = await engine.capture(context);

      expect(result.tiles).toHaveLength(256);
      expect(stored).toHaveLength(256);
      expect(result.partialCapture).toBeUndefined();
      expect(stored[114]?.index).toBe(114);
      expect(stored[115]?.index).toBe(115);
      expect(stored.at(-1)?.index).toBe(255);
      expect(onPlan).toHaveBeenCalledWith(
        expect.any(Object),
        { x: 0, y: 0, width: 100, height: 20_500 },
        expect.arrayContaining([
          expect.objectContaining({ index: 0 }),
          expect.objectContaining({ index: 255 }),
        ]),
        undefined,
      );
      expect(
        scrollAndSettle.mock.calls
          .slice(1)
          .every(([request]) => request.expectedScrollHeight === undefined),
      ).toBe(true);
    },
    30_000,
  );
});
