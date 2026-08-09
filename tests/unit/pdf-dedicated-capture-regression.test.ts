import { describe, expect, it, vi } from "vitest";

import { CaptureRateLimiter } from "@background/capture-rate-limiter";
import {
  ChromeScrollAreaPageAdapter,
  type ScrollAreaBrowserAdapter,
  type ScrollAreaPageAdapter,
  type ScrollAreaPageRequest,
  type ScrollAreaPageResult,
} from "@background/scroll-area-page-adapter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import { ScrollAreaCaptureEngine } from "@capture/scroll-area-capture-engine";
import { PROTOCOL_VERSION } from "@shared/constants";
import type { CaptureTile, DocumentPageMap } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const HUNDRED_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAnklEQVR42u3QMQEAAAgDILV/51nBzwci0CmuRoEsWbJkyZKlQJYsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWbJkyVIgS5YsWbJkKZAlS5YsWbIUyJIlS5YsWQpkyZIlS5YsBbJkyZIlS5YCWbJkyZIlS4EsWd8Wil4Bx2r6t7cAAAAASUVORK5CYII=";

const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "neutral-scroll-selection",
  tagName: "section",
  classNames: ["messages"],
  scrollable: true,
  captureKind: "full-scroll-content" as const,
};

function pageMap(count: number): DocumentPageMap {
  return {
    schemaVersion: 1,
    strategy: "dom",
    confidence: 1,
    complete: true,
    sourcePageCount: count,
    pages: Array.from({ length: count }, (_, index) => ({
      index,
      sourceRectCss: { x: 0, y: index * 100, width: 100, height: 90 },
    })),
  };
}

function pageResult(
  request: ScrollAreaPageRequest,
  documentPageMap?: DocumentPageMap,
): ScrollAreaPageResult {
  return {
    requestedScrollLeft: request.scrollLeft,
    requestedScrollTop: request.scrollTop,
    actualScrollLeft: request.scrollLeft,
    actualScrollTop: request.scrollTop,
    scrollWidth: 100,
    scrollHeight: documentPageMap?.sourcePageCount === undefined ? 220 : documentPageMap.sourcePageCount * 100,
    clientWidth: 100,
    clientHeight: 100,
    viewportWidth: 100,
    viewportHeight: 100,
    devicePixelRatio: 1,
    captureCropCss: { x: 0, y: 0, width: 100, height: 100 },
    hiddenStickyElements: 0,
    stableSamples: 1,
    mutationCount: 0,
    scrollSnapped: false,
    layoutChanged: false,
    ...(documentPageMap === undefined ? {} : { documentPageMap }),
  };
}

function engineHarness(map: DocumentPageMap | undefined) {
  const scrollAndSettle = vi.fn((request: ScrollAreaPageRequest) =>
    Promise.resolve(pageResult(request, request.forcePdfDiscovery === true ? map : undefined)),
  );
  const pages: ScrollAreaPageAdapter = {
    scrollAndSettle,
    cleanup: vi.fn(() =>
      Promise.resolve({
        restoredElements: 0,
        skippedElements: 0,
        scrollRestored: true,
        documentScrollRestored: true,
      }),
    ),
  };
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
  const context = {
    jobId: "job-dedicated-pdf",
    tabId: 7,
    windowId: 3,
    settings: {
      ...DEFAULT_CAPTURE_SETTINGS,
      outputFormat: "pdf" as const,
      lazyLoad: { ...DEFAULT_CAPTURE_SETTINGS.lazyLoad, settleMs: 0 },
      limits: { ...DEFAULT_CAPTURE_SETTINGS.limits, maxTiles: 1 },
    },
    targetRect: { x: 0, y: 0, width: 100, height: 220 },
    targetDescriptor: descriptor,
    cancellation: { cancelled: false, keepPartial: false, throwIfCancelled: () => undefined },
    onPlan: () => Promise.resolve(),
    storeTile(tile: CaptureTile) {
      stored.push(tile);
      return Promise.resolve();
    },
    reportProgress: () => undefined,
  };
  return { engine, context, stored, scrollAndSettle };
}

describe("dedicated PDF capture regression", () => {
  it("captures all 220 logical pages through neutral DOM without a document-wide maxTiles cap", async () => {
    const harness = engineHarness(pageMap(220));

    const result = await harness.engine.capture(harness.context);

    expect(result.documentPageMap?.sourcePageCount).toBe(220);
    expect(result.tiles).toHaveLength(220);
    expect(harness.stored).toHaveLength(220);
    expect(result.partialCapture).toBeUndefined();
    expect(harness.scrollAndSettle).toHaveBeenCalledWith(
      expect.objectContaining({ forcePdfDiscovery: true }),
    );
  }, 30_000);

  it("fails closed instead of silently raster-paginating when logical pages cannot be verified", async () => {
    const harness = engineHarness(undefined);

    await expect(harness.engine.capture(harness.context)).rejects.toMatchObject({
      data: {
        code: "E_LAYOUT_UNSTABLE",
        causeCode: "PdfPageMapUnverified",
        fallbackAllowed: false,
      },
    });
    expect(harness.stored).toHaveLength(0);
  });

  it("lets an explicit force flag invoke viewer discovery even for neutral container names", async () => {
    const now = new Date("2026-08-09T11:00:00.000Z");
    const browserResponse = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: "request-1",
      source: "content" as const,
      target: "background" as const,
      type: "SCROLL_AREA_SCROLLED" as const,
      payload: {
        jobId: "job-1",
        descriptor,
        requestedScrollLeft: 0,
        requestedScrollTop: 0,
        actualScrollLeft: 0,
        actualScrollTop: 0,
        scrollWidth: 100,
        scrollHeight: 220,
        clientWidth: 100,
        clientHeight: 100,
        viewportWidth: 100,
        viewportHeight: 100,
        devicePixelRatio: 1,
        captureCropCss: { x: 0, y: 0, width: 100, height: 100 },
        hiddenStickyElements: 0,
        stableSamples: 1,
        mutationCount: 0,
        scrollSnapped: false,
        layoutChanged: false,
      },
      sentAt: now.toISOString(),
    };
    const browser: ScrollAreaBrowserAdapter = {
      injectContentScript: vi.fn(() => Promise.resolve()),
      sendMessage: vi.fn(() => Promise.resolve(browserResponse)),
    };
    const discovered = pageMap(2);
    const discover = vi.fn(() => Promise.resolve(discovered));
    const adapter = new ChromeScrollAreaPageAdapter(
      browser,
      () => now,
      () => "request-1",
      { discover },
    );

    const result = await adapter.scrollAndSettle({
      tabId: 7,
      jobId: "job-1",
      descriptor,
      scrollLeft: 0,
      scrollTop: 0,
      row: 0,
      column: 0,
      rows: 1,
      columns: 1,
      fixedElementMode: "preserve",
      settleMs: 0,
      forcePdfDiscovery: true,
    });

    expect(discover).toHaveBeenCalledOnce();
    expect(result.documentPageMap).toEqual(discovered);
  });
});
