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
import type { DocumentPageMap } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "s34-interference-viewer",
  tagName: "section",
  classNames: ["pdf-viewer"],
  scrollable: true,
  captureKind: "full-scroll-content" as const,
};

const pageMap: DocumentPageMap = {
  schemaVersion: 1,
  strategy: "dom",
  confidence: 0.99,
  complete: true,
  sourcePageCount: 1,
  pages: [{ index: 0, sourceRectCss: { x: 0, y: 0, width: 100, height: 100 } }],
};

function result(request: ScrollAreaPageRequest, initial: boolean): ScrollAreaPageResult {
  return {
    requestedScrollLeft: request.scrollLeft,
    requestedScrollTop: request.scrollTop,
    actualScrollLeft: initial ? request.scrollLeft : request.scrollLeft + 12,
    actualScrollTop: request.scrollTop,
    scrollWidth: 100,
    scrollHeight: 100,
    clientWidth: 100,
    clientHeight: 100,
    viewportWidth: 100,
    viewportHeight: 100,
    devicePixelRatio: 1,
    captureCropCss: { x: 0, y: 0, width: 100, height: 100 },
    hiddenStickyElements: 0,
    stableSamples: 1,
    mutationCount: 0,
    scrollSnapped: !initial,
    layoutChanged: false,
    ...(initial ? { documentPageMap: pageMap } : {}),
  };
}

describe("S34 page-native user interference", () => {
  it("fails before storing pixels when the viewer leaves the requested page-local scroll position", async () => {
    let calls = 0;
    const pages: ScrollAreaPageAdapter = {
      scrollAndSettle: vi.fn((request: ScrollAreaPageRequest) => {
        calls += 1;
        return Promise.resolve(result(request, calls === 1));
      }),
      cleanup: () =>
        Promise.resolve({
          restoredElements: 0,
          skippedElements: 0,
          scrollRestored: true,
          documentScrollRestored: true,
        }),
    };
    const captureVisibleTab = vi.fn(() => Promise.reject(new Error("must not capture")));
    const tabs: TabsCaptureAdapter = {
      queryActiveTab: () => Promise.resolve({ id: 7, windowId: 3, active: true }),
      captureVisibleTab,
    };
    const fallback: CaptureEngine = {
      kind: "scroll",
      capture: () => Promise.reject(new Error("verified PDF must not use fallback")),
    };
    const engine = new PageNativeCaptureEngine({
      pages,
      tabs,
      fallback,
      limiter: new CaptureRateLimiter({
        minimumIntervalMs: 0,
        now: () => 1,
        sleep: () => Promise.resolve(),
      }),
      storagePressure: {
        assess: (requestedBytes, minimumProgressBytes) =>
          Promise.resolve({
            level: "healthy",
            reserveBytes: 0,
            requestedBytes,
            minimumProgressBytes,
            safeBatchBytes: requestedBytes,
            availableBytes: Number.MAX_SAFE_INTEGER,
            quotaBytes: Number.MAX_SAFE_INTEGER,
            usageBytes: 0,
            pauseRequired: false,
          }),
      },
    });
    const storeTile = vi.fn(() => Promise.resolve());
    const context: CaptureEngineContext = {
      jobId: "job-s34-interference",
      tabId: 7,
      windowId: 3,
      settings: {
        ...DEFAULT_CAPTURE_SETTINGS,
        lazyLoad: { ...DEFAULT_CAPTURE_SETTINGS.lazyLoad, settleMs: 0 },
      },
      targetRect: { x: 0, y: 0, width: 100, height: 100 },
      targetDescriptor: descriptor,
      cancellation: { cancelled: false, keepPartial: false, throwIfCancelled: () => undefined },
      onPlan: () => Promise.resolve(),
      storeTile,
      reportProgress: () => undefined,
    };

    await expect(engine.capture(context)).rejects.toMatchObject({
      data: {
        code: "E_LAYOUT_UNSTABLE",
        causeCode: "PdfPageScrollPositionMismatch",
      },
    });
    expect(captureVisibleTab).not.toHaveBeenCalled();
    expect(storeTile).not.toHaveBeenCalled();
  });
});
