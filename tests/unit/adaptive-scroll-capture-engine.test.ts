import { describe, expect, it, vi } from "vitest";

import { CaptureRateLimiter } from "@background/capture-rate-limiter";
import type {
  ScrollCapturePageAdapter,
  ScrollCapturePageRequest,
  ScrollCapturePageResult,
} from "@background/scroll-capture-page-adapter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import type { CaptureEngineContext } from "@capture/capture-engine";
import { planAdaptiveCaptureRow } from "@capture/adaptive-frontier-planner";
import { AdaptiveScrollCaptureEngine } from "@capture/adaptive-scroll-capture-engine";
import type { AdaptiveCaptureFrontier, CaptureTile } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const HUNDRED_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAnklEQVR42u3QMQEAAAgDILV/51nBzwci0CmuRoEsWbJkyZKlQJYsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWd8Wil4Bx2r6t7cAAAAASUVORK5CYII=";

function pageResult(
  request: ScrollCapturePageRequest,
  documentWidth: number,
  documentHeight: number,
): ScrollCapturePageResult {
  const maximumX = Math.max(0, documentWidth - 100);
  const maximumY = Math.max(0, documentHeight - 100);
  return {
    requestedScrollX: request.scrollX,
    requestedScrollY: request.scrollY,
    actualScrollX: Math.min(request.scrollX, maximumX),
    actualScrollY: Math.min(request.scrollY, maximumY),
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth,
    documentHeight,
    devicePixelRatio: 1,
    documentToken: "document-1",
    fixedCandidates: 0,
    hiddenFixedElements: 0,
    stableSamples: 1,
    mutationCount: 0,
    scrollSnapped: false,
    layoutChanged:
      documentWidth !== request.expectedDocumentWidth ||
      documentHeight !== request.expectedDocumentHeight,
  };
}

function setup(options: {
  documentWidth?: number;
  documentHeight: () => number;
  resume?: CaptureEngineContext["resume"];
}) {
  const captureVisibleTab = vi.fn(() => Promise.resolve(HUNDRED_PIXEL_PNG));
  const pages: ScrollCapturePageAdapter = {
    scrollAndSettle: vi.fn((request: ScrollCapturePageRequest) =>
      Promise.resolve(
        pageResult(request, options.documentWidth ?? 100, options.documentHeight()),
      ),
    ),
    cleanup: vi.fn(() =>
      Promise.resolve({
        restoredElements: 0,
        skippedElements: 0,
        actualScrollX: 0,
        actualScrollY: 0,
      }),
    ),
  };
  const tabs: TabsCaptureAdapter = {
    queryActiveTab: () => Promise.resolve({ id: 7, windowId: 3, active: true }),
    captureVisibleTab,
  };
  const engine = new AdaptiveScrollCaptureEngine({
    pages,
    tabs,
    overlapCss: 20,
    maxDurationMs: 60_000,
    now: () => new Date("2026-08-05T00:00:00.000Z"),
    limiter: new CaptureRateLimiter({
      minimumIntervalMs: 0,
      now: () => 1,
      sleep: () => Promise.resolve(),
    }),
  });
  const stored: CaptureTile[] = [];
  const checkpoints: AdaptiveCaptureFrontier[] = [];
  const plans: CaptureTile[][] = [];
  const context: CaptureEngineContext = {
    jobId: "job-adaptive",
    tabId: 7,
    windowId: 3,
    mode: "full-page",
    settings: {
      ...DEFAULT_CAPTURE_SETTINGS,
      lazyLoad: { ...DEFAULT_CAPTURE_SETTINGS.lazyLoad, settleMs: 0 },
      limits: {
        ...DEFAULT_CAPTURE_SETTINGS.limits,
        maxTiles: 50,
      },
    },
    preparation: {
      preparationId: "job-adaptive",
      snapshotVersion: 1,
      originalScroll: { x: 0, y: 42 },
      preparedScroll: { x: 0, y: 0 },
      documentWidth: options.documentWidth ?? 100,
      documentHeight: options.documentHeight(),
      reachedLimit: false,
      completionReason: "lazy-disabled",
      stableSamples: 1,
      mutationCount: 0,
      modifiedNodeCount: 0,
    },
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    cancellation: {
      cancelled: false,
      keepPartial: false,
      throwIfCancelled: () => undefined,
    },
    onPlan(_metrics, _targetRect, tiles) {
      plans.push(tiles.map((tile) => ({ ...tile })));
      return Promise.resolve();
    },
    checkpointFrontier(frontier) {
      checkpoints.push({ ...frontier });
      return Promise.resolve();
    },
    discardTilesFromIndex: () => Promise.resolve(),
    storeTile(tile) {
      stored.push(tile);
      return Promise.resolve();
    },
    reportProgress: () => undefined,
  };
  return { engine, context, pages, captureVisibleTab, stored, checkpoints, plans };
}

function resumeFrontier(patch: Partial<AdaptiveCaptureFrontier> = {}): AdaptiveCaptureFrontier {
  return {
    schemaVersion: 1,
    nextYCss: 0,
    capturedBottomCss: 0,
    observedDocumentHeightCss: 100,
    stableBottomRounds: 4,
    capturedRows: 0,
    storedBytes: 80,
    startedAt: "2026-08-05T00:00:00.000Z",
    lastGrowthAt: "2026-08-05T00:00:00.000Z",
    sourceDocumentToken: "document-1",
    documentWidthCss: 180,
    viewportWidthCss: 100,
    viewportHeightCss: 100,
    devicePixelRatio: 1,
    ...patch,
  };
}

describe("AdaptiveScrollCaptureEngine", () => {
  it("continues after finite lazy growth and completes only at the new stable bottom", async () => {
    let captures = 0;
    const harness = setup({
      documentHeight: () => (captures === 0 ? 180 : 260),
    });
    harness.captureVisibleTab.mockImplementation(() => {
      captures += 1;
      return Promise.resolve(HUNDRED_PIXEL_PNG);
    });

    const result = await harness.engine.capture(harness.context);

    expect(result.targetRect).toEqual({ x: 0, y: 0, width: 100, height: 260 });
    expect(result.tiles).toHaveLength(3);
    expect(result.tiles.every((tile) => tile.status === "stored")).toBe(true);
    expect(harness.stored.map((tile) => tile.outputRectCss)).toEqual([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 100, width: 100, height: 80 },
      { x: 0, y: 180, width: 100, height: 80 },
    ]);
    expect(harness.checkpoints.some((frontier) => frontier.observedDocumentHeightCss === 260)).toBe(
      true,
    );
    expect(harness.checkpoints.at(-1)?.capturedBottomCss).toBe(260);
    expect(harness.plans.at(-1)?.map((tile) => tile.index)).toEqual([0, 1, 2]);
  });

  it("resumes a partially stored row without recapturing its stored columns", async () => {
    const planned = planAdaptiveCaptureRow({
      jobId: "job-adaptive",
      nextTileIndex: 0,
      row: 0,
      nextYCss: 0,
      documentWidthCss: 180,
      documentHeightCss: 100,
      viewportWidthCss: 100,
      viewportHeightCss: 100,
      maxCssWidth: 500,
      overlapCss: 20,
      remainingTiles: 10,
    }).tiles;
    const first = planned[0];
    if (first === undefined) throw new Error("Expected first adaptive tile.");
    const resumeTiles: CaptureTile[] = [
      {
        ...first,
        status: "stored",
        attempts: 1,
        byteLength: 80,
        mimeType: "image/png",
      },
      ...(planned[1] === undefined ? [] : [planned[1]]),
    ];
    const harness = setup({
      documentWidth: 180,
      documentHeight: () => 100,
      resume: {
        frontier: resumeFrontier(),
        tilePlan: resumeTiles,
      },
    });

    const result = await harness.engine.capture(harness.context);

    expect(result.targetRect).toEqual({ x: 0, y: 0, width: 180, height: 100 });
    expect(result.tiles).toHaveLength(2);
    expect(harness.captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(harness.stored.map((tile) => tile.index)).toEqual([1]);
    expect(harness.checkpoints.at(-1)).toMatchObject({
      capturedRows: 1,
      capturedBottomCss: 100,
      nextYCss: 100,
    });
  });

  it("rejects resume after navigation instead of joining tiles from another document", async () => {
    const harness = setup({
      documentWidth: 180,
      documentHeight: () => 100,
      resume: {
        frontier: resumeFrontier({ sourceDocumentToken: "old-document" }),
        tilePlan: [],
      },
    });

    await expect(harness.engine.capture(harness.context)).rejects.toThrowError(
      expect.objectContaining({ name: "E_LAYOUT_UNSTABLE" }),
    );
    expect(harness.captureVisibleTab).not.toHaveBeenCalled();
  });
});
