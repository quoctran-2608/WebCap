import { describe, expect, it, vi } from "vitest";

import type { PdfViewerDiscoveryPort } from "@background/pdf-viewer-discovery";
import {
  ChromeScrollAreaPageAdapter,
  type ScrollAreaBrowserAdapter,
} from "@background/scroll-area-page-adapter";
import { PROTOCOL_VERSION } from "@shared/constants";
import type { DocumentPageMap, ElementTargetDescriptor } from "@shared/contracts/domain";

const now = new Date("2026-08-07T16:00:00.000Z");
const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "scroll-selection",
  tagName: "section",
  classNames: ["pdf-viewer"],
  scrollable: true,
  captureKind: "full-scroll-content" as const,
};

function response(
  requestId: string,
  documentPageMap?: DocumentPageMap,
  responseDescriptor: ElementTargetDescriptor = descriptor,
) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    source: "content",
    target: "background",
    type: "SCROLL_AREA_SCROLLED",
    payload: {
      jobId: "job-1",
      descriptor: responseDescriptor,
      requestedScrollLeft: 0,
      requestedScrollTop: 0,
      actualScrollLeft: 0,
      actualScrollTop: 0,
      scrollWidth: 900,
      scrollHeight: 6000,
      clientWidth: 760,
      clientHeight: 700,
      viewportWidth: 1200,
      viewportHeight: 800,
      devicePixelRatio: 1,
      captureCropCss: { x: 120, y: 60, width: 760, height: 700 },
      hiddenStickyElements: 0,
      stableSamples: 1,
      mutationCount: 0,
      scrollSnapped: false,
      layoutChanged: false,
      ...(documentPageMap === undefined ? {} : { documentPageMap }),
    },
    sentAt: now.toISOString(),
  };
}

const discoveredMap: DocumentPageMap = {
  schemaVersion: 1,
  strategy: "dom",
  confidence: 0.96,
  complete: true,
  sourcePageCount: 6,
  pages: Array.from({ length: 6 }, (_, index) => ({
    index,
    sourceRectCss: { x: 100, y: index * 1000, width: 600, height: 980 },
  })),
};

const projectedMap: DocumentPageMap = {
  ...discoveredMap,
  strategy: "projected",
  confidence: 0.82,
};

const expandedMap: DocumentPageMap = {
  ...discoveredMap,
  pages: discoveredMap.pages.map((page) =>
    page.index === 5
      ? { ...page, sourceRectCss: { ...page.sourceRectCss, y: 6500 } }
      : page,
  ),
};

describe("ChromeScrollAreaPageAdapter S30 discovery", () => {
  it("runs incremental PDF viewer discovery only for the initial measurement probe", async () => {
    const browser: ScrollAreaBrowserAdapter = {
      injectContentScript: vi.fn(() => Promise.resolve()),
      sendMessage: vi.fn((_tabId, message: unknown) => {
        const requestId = (message as { requestId: string }).requestId;
        return Promise.resolve(response(requestId));
      }),
    };
    const discover = vi.fn(() => Promise.resolve(discoveredMap));
    const discovery: PdfViewerDiscoveryPort = { discover };
    let sequence = 0;
    const adapter = new ChromeScrollAreaPageAdapter(
      browser,
      () => now,
      () => `request-${++sequence}`,
      discovery,
    );

    const initial = await adapter.scrollAndSettle({
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
      settleMs: 20,
    });
    expect(initial.documentPageMap).toEqual(discoveredMap);
    expect(discover).toHaveBeenCalledTimes(1);

    await adapter.scrollAndSettle({
      tabId: 7,
      jobId: "job-1",
      descriptor,
      scrollLeft: 0,
      scrollTop: 700,
      row: 1,
      column: 0,
      rows: 8,
      columns: 1,
      fixedElementMode: "smart",
      settleMs: 20,
    });
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("uses the discovered page extent when lazy viewer growth exceeds the initial probe", async () => {
    const browser: ScrollAreaBrowserAdapter = {
      injectContentScript: vi.fn(() => Promise.resolve()),
      sendMessage: vi.fn((_tabId, message: unknown) => {
        const requestId = (message as { requestId: string }).requestId;
        return Promise.resolve(response(requestId, projectedMap));
      }),
    };
    const discovery: PdfViewerDiscoveryPort = {
      discover: vi.fn(() => Promise.resolve(expandedMap)),
    };
    const adapter = new ChromeScrollAreaPageAdapter(
      browser,
      () => now,
      () => "request-expanded",
      discovery,
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
    });
    expect(result.scrollHeight).toBe(7480);
    expect(result.layoutChanged).toBe(false);
    expect(result.documentPageMap).toEqual(expandedMap);
  });

  it("does not promote the legacy projected map when incremental discovery has no proof", async () => {
    const browser: ScrollAreaBrowserAdapter = {
      injectContentScript: vi.fn(() => Promise.resolve()),
      sendMessage: vi.fn((_tabId, message: unknown) => {
        const requestId = (message as { requestId: string }).requestId;
        return Promise.resolve(response(requestId, projectedMap));
      }),
    };
    const discovery: PdfViewerDiscoveryPort = {
      discover: vi.fn(() => Promise.resolve(undefined)),
    };
    const adapter = new ChromeScrollAreaPageAdapter(
      browser,
      () => now,
      () => "request-projected",
      discovery,
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
    });
    expect(result.documentPageMap).toBeUndefined();
  });

  it("skips the expensive discovery pass for ordinary scroll containers without page evidence", async () => {
    const ordinaryDescriptor: ElementTargetDescriptor = {
      ...descriptor,
      classNames: ["data-grid"],
    };
    const browser: ScrollAreaBrowserAdapter = {
      injectContentScript: vi.fn(() => Promise.resolve()),
      sendMessage: vi.fn((_tabId, message: unknown) => {
        const requestId = (message as { requestId: string }).requestId;
        return Promise.resolve(response(requestId, undefined, ordinaryDescriptor));
      }),
    };
    const discover = vi.fn(() => Promise.resolve(discoveredMap));
    const discovery: PdfViewerDiscoveryPort = { discover };
    const adapter = new ChromeScrollAreaPageAdapter(
      browser,
      () => now,
      () => "request-ordinary",
      discovery,
    );

    const result = await adapter.scrollAndSettle({
      tabId: 7,
      jobId: "job-1",
      descriptor: ordinaryDescriptor,
      scrollLeft: 0,
      scrollTop: 0,
      row: 0,
      column: 0,
      rows: 1,
      columns: 1,
      fixedElementMode: "preserve",
      settleMs: 0,
    });
    expect(discover).not.toHaveBeenCalled();
    expect(result.documentPageMap).toBeUndefined();
  });
});
