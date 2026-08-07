import { describe, expect, it, vi } from "vitest";

import type { PdfViewerDiscoveryPort } from "@background/pdf-viewer-discovery";
import {
  ChromeScrollAreaPageAdapter,
  type ScrollAreaBrowserAdapter,
} from "@background/scroll-area-page-adapter";
import { PROTOCOL_VERSION } from "@shared/constants";
import type { DocumentPageMap } from "@shared/contracts/domain";

const now = new Date("2026-08-07T16:00:00.000Z");
const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "scroll-selection",
  tagName: "section",
  classNames: ["pdf-viewer"],
  scrollable: true,
  captureKind: "full-scroll-content" as const,
};

function response(requestId: string) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    source: "content",
    target: "background",
    type: "SCROLL_AREA_SCROLLED",
    payload: {
      jobId: "job-1",
      descriptor,
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
});
