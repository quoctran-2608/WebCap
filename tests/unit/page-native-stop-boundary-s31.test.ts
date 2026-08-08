import { describe, expect, it, vi } from "vitest";

import { CaptureRateLimiter } from "@background/capture-rate-limiter";
import type {
  ScrollAreaPageAdapter,
  ScrollAreaPageRequest,
  ScrollAreaPageResult,
} from "@background/scroll-area-page-adapter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import type { CaptureCancellation, CaptureEngineContext } from "@capture/capture-engine";
import { ScrollAreaCaptureEngine } from "@capture/scroll-area-capture-engine";
import type { CaptureTile, DocumentPageMap } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const HUNDRED_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAnklEQVR42u3QMQEAAAgDILV/51nBzwci0CmuRoEsWbJkyZKlQJYsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWbJkyVIgS5YsWbJkKZAlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWd8Wil4Bx2r6t7cAAAAASUVORK5CYII=";

const documentPageMap: DocumentPageMap = {
  schemaVersion: 1,
  strategy: "dom",
  confidence: 1,
  complete: true,
  sourcePageCount: 2,
  pages: [
    { index: 0, sourceRectCss: { x: 10, y: 0, width: 80, height: 180 } },
    { index: 1, sourceRectCss: { x: 10, y: 190, width: 80, height: 90 } },
  ],
};

class MutableKeepPartialCancellation implements CaptureCancellation {
  cancelled = false;
  keepPartial = true;

  throwIfCancelled(
    stage: "prepare" | "measure" | "plan" | "capture" | "cleanup" = "capture",
  ): void {
    if (!this.cancelled) return;
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_CANCELLED",
        stage,
        message: "cancelled",
        userMessageKey: "errors.cancelled",
        retryable: true,
        fallbackAllowed: false,
        causeCode: "UserCancellation",
      }),
    );
  }
}

function pageResult(request: ScrollAreaPageRequest): ScrollAreaPageResult {
  const maximumScrollTop = 180;
  const actualScrollTop = Math.min(maximumScrollTop, request.scrollTop);
  return {
    requestedScrollLeft: request.scrollLeft,
    requestedScrollTop: request.scrollTop,
    actualScrollLeft: 0,
    actualScrollTop,
    scrollWidth: 100,
    scrollHeight: 280,
    clientWidth: 100,
    clientHeight: 100,
    viewportWidth: 100,
    viewportHeight: 100,
    devicePixelRatio: 1,
    captureCropCss: { x: 0, y: 0, width: 100, height: 100 },
    hiddenStickyElements: 0,
    stableSamples: 2,
    mutationCount: 0,
    scrollSnapped: request.scrollLeft !== 0 || actualScrollTop !== request.scrollTop,
    layoutChanged: false,
    ...(request.scrollTop === 0 && request.row === 0 && request.column === 0
      ? { documentPageMap }
      : {}),
  };
}

describe("S31 page-boundary stop", () => {
  it("finishes the current logical page before honoring keep-partial cancellation", async () => {
    const cancellation = new MutableKeepPartialCancellation();
    const scrollAndSettle = vi.fn((request: ScrollAreaPageRequest) =>
      Promise.resolve(pageResult(request)),
    );
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
      captureVisibleTab: vi.fn(() => Promise.resolve(HUNDRED_PIXEL_PNG)),
    };
    const stored: CaptureTile[] = [];
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
    const context: CaptureEngineContext = {
      jobId: "job-page-boundary",
      tabId: 7,
      windowId: 3,
      settings: {
        ...DEFAULT_CAPTURE_SETTINGS,
        lazyLoad: { ...DEFAULT_CAPTURE_SETTINGS.lazyLoad, settleMs: 0 },
        limits: { ...DEFAULT_CAPTURE_SETTINGS.limits, maxTiles: 1 },
      },
      targetRect: { x: 0, y: 0, width: 100, height: 280 },
      targetDescriptor: {
        schemaVersion: 1,
        selectionId: "pdf-scroll-selection",
        tagName: "div",
        id: "pdf-scroll",
        classNames: [],
        scrollable: true,
        captureKind: "full-scroll-content",
      },
      cancellation,
      onPlan: () => Promise.resolve(),
      storeTile(tile) {
        stored.push(tile);
        if (stored.length === 1) cancellation.cancelled = true;
        return Promise.resolve();
      },
      reportProgress: () => undefined,
    };

    await expect(engine.capture(context)).rejects.toMatchObject({
      data: { code: "E_CANCELLED", causeCode: "UserCancellation" },
    });

    expect(stored).toHaveLength(2);
    expect(stored.every((tile) => tile.status === "stored")).toBe(true);
    expect(stored.map((tile) => tile.outputRectCss)).toEqual([
      { x: 10, y: 0, width: 80, height: 100 },
      { x: 10, y: 100, width: 80, height: 80 },
    ]);
    expect(scrollAndSettle.mock.calls.every(([request]) => request.scrollTop < 190)).toBe(true);
  });
});
