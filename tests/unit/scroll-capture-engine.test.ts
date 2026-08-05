import { describe, expect, it, vi } from "vitest";

import { CaptureRateLimiter } from "@background/capture-rate-limiter";
import type {
  ScrollCapturePageAdapter,
  ScrollCapturePageRequest,
  ScrollCapturePageResult,
} from "@background/scroll-capture-page-adapter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import type { CaptureEngineContext } from "@capture/capture-engine";
import { ScrollCaptureEngine } from "@capture/scroll-capture-engine";
import type { CaptureTile } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const HUNDRED_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAnklEQVR42u3QMQEAAAgDILV/51nBzwci0CmuRoEsWbJkyZKlQJYsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWd8Wil4Bx2r6t7cAAAAASUVORK5CYII=";
const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

function pageResult(
  request: ScrollCapturePageRequest,
  patch: Partial<ScrollCapturePageResult> = {},
): ScrollCapturePageResult {
  return {
    requestedScrollX: request.scrollX,
    requestedScrollY: request.scrollY,
    actualScrollX: request.scrollX,
    actualScrollY: request.scrollY,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 220,
    devicePixelRatio: 1,
    documentToken: "document-1",
    fixedCandidates: 2,
    hiddenFixedElements: request.fixedElementMode === "preserve" ? 0 : 1,
    stableSamples: 1,
    mutationCount: 0,
    scrollSnapped: false,
    layoutChanged: false,
    ...patch,
  };
}

function setup(
  options: {
    pagePatch?: (request: ScrollCapturePageRequest) => Partial<ScrollCapturePageResult>;
    activeTabId?: number;
    cleanupSkipped?: number;
    captureDataUrl?: string;
  } = {},
) {
  const scrollAndSettle = vi.fn((request: ScrollCapturePageRequest) =>
    Promise.resolve(pageResult(request, options.pagePatch?.(request))),
  );
  const cleanup = vi.fn(() =>
    Promise.resolve({
      restoredElements: 2,
      skippedElements: options.cleanupSkipped ?? 0,
      actualScrollX: 0,
      actualScrollY: 0,
    }),
  );
  const pages: ScrollCapturePageAdapter = { scrollAndSettle, cleanup };
  const captureVisibleTab = vi.fn(() =>
    Promise.resolve(options.captureDataUrl ?? HUNDRED_PIXEL_PNG),
  );
  const tabs: TabsCaptureAdapter = {
    queryActiveTab: () =>
      Promise.resolve({
        id: options.activeTabId ?? 7,
        windowId: 3,
        active: true,
      }),
    captureVisibleTab,
  };
  const engine = new ScrollCaptureEngine({
    pages,
    tabs,
    overlapCss: 20,
    limiter: new CaptureRateLimiter({
      minimumIntervalMs: 0,
      now: () => 1,
      sleep: () => Promise.resolve(),
    }),
  });
  const stored: Array<{ tile: CaptureTile; blob: Blob }> = [];
  const progress: string[] = [];
  const onPlan = vi.fn(() => Promise.resolve());
  const context: CaptureEngineContext = {
    jobId: "job-scroll",
    tabId: 7,
    windowId: 3,
    settings: {
      ...DEFAULT_CAPTURE_SETTINGS,
      lazyLoad: { ...DEFAULT_CAPTURE_SETTINGS.lazyLoad, settleMs: 0 },
    },
    preparation: {
      preparationId: "job-scroll",
      snapshotVersion: 1,
      originalScroll: { x: 0, y: 42 },
      preparedScroll: { x: 0, y: 0 },
      documentWidth: 100,
      documentHeight: 220,
      reachedLimit: false,
      completionReason: "stable",
      stableSamples: 2,
      mutationCount: 0,
      modifiedNodeCount: 0,
    },
    cancellation: {
      cancelled: false,
      keepPartial: false,
      throwIfCancelled: () => undefined,
    },
    onPlan,
    storeTile(tile, blob) {
      stored.push({ tile, blob });
      return Promise.resolve();
    },
    reportProgress(event) {
      progress.push(event.stage);
    },
  };
  return {
    engine,
    context,
    scrollAndSettle,
    cleanup,
    captureVisibleTab,
    stored,
    progress,
    onPlan,
  };
}

describe("ScrollCaptureEngine", () => {
  it("scrolls, rate-limits visible captures, and stores overlap-aware tiles", async () => {
    const harness = setup();

    const result = await harness.engine.capture(harness.context);

    expect(result.tiles).toHaveLength(3);
    expect(harness.captureVisibleTab).toHaveBeenCalledTimes(3);
    expect(harness.scrollAndSettle).toHaveBeenCalledTimes(4);
    expect(harness.onPlan).toHaveBeenCalledTimes(1);
    expect(harness.stored.map(({ tile }) => tile.index)).toEqual([0, 1, 2]);
    expect(harness.stored.map(({ tile }) => tile.outputRectCss)).toEqual([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 100, width: 100, height: 80 },
      { x: 0, y: 180, width: 100, height: 40 },
    ]);
    expect(
      harness.stored.every(
        ({ tile, blob }) =>
          tile.status === "stored" &&
          tile.mimeType === "image/png" &&
          tile.expectedPixelWidth === 100 &&
          tile.expectedPixelHeight === 100 &&
          tile.byteLength === blob.size &&
          blob.size > 0,
      ),
    ).toBe(true);
    expect(harness.progress).toContain("scrolling");
    expect(harness.progress).toContain("capturing");
    expect(harness.progress).toContain("storing");
  });

  it("fails before capturing when the source tab is no longer active", async () => {
    const harness = setup({ activeTabId: 99 });

    await expect(harness.engine.capture(harness.context)).rejects.toThrowError(
      expect.objectContaining({ name: "E_TAB_NOT_ACTIVE" }),
    );
    expect(harness.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("rejects scroll snap or an immovable scroll position", async () => {
    const harness = setup({
      pagePatch(request) {
        return request.totalTiles > 1 && request.tileIndex === 1
          ? { actualScrollY: request.scrollY - 10, scrollSnapped: true }
          : {};
      },
    });

    await expect(harness.engine.capture(harness.context)).rejects.toThrowError(
      expect.objectContaining({ name: "E_LAYOUT_UNSTABLE" }),
    );
    expect(harness.captureVisibleTab).toHaveBeenCalledTimes(1);
  });

  it("rejects a screenshot whose pixel dimensions do not match viewport DPR", async () => {
    const harness = setup({ captureDataUrl: ONE_PIXEL_PNG });

    await expect(harness.engine.capture(harness.context)).rejects.toThrowError(
      expect.objectContaining({ name: "E_LAYOUT_UNSTABLE" }),
    );
    expect(harness.stored).toHaveLength(0);
  });

  it("reports compare-before-restore conflicts as partial cleanup", async () => {
    const harness = setup({ cleanupSkipped: 1 });

    await expect(harness.engine.cleanup?.(harness.context)).rejects.toThrowError(
      expect.objectContaining({ name: "E_CLEANUP_PARTIAL" }),
    );
    expect(harness.cleanup).toHaveBeenCalledWith(7, "job-scroll", 0, 0);
  });
});
