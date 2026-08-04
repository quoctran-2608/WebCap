import { describe, expect, it, vi } from "vitest";

import {
  ChromeScrollAreaPageAdapter,
  type ScrollAreaBrowserAdapter,
} from "@background/scroll-area-page-adapter";
import { PROTOCOL_VERSION } from "@shared/constants";

const now = new Date("2026-08-04T03:00:00.000Z");
const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "scroll-selection",
  tagName: "section",
  classNames: ["messages"],
  scrollable: true,
  captureKind: "full-scroll-content" as const,
};

function browser(responses: unknown[]) {
  const injectContentScript = vi.fn(() => Promise.resolve());
  const sendMessage = vi.fn(() => Promise.resolve(responses.shift()));
  return {
    value: { injectContentScript, sendMessage } satisfies ScrollAreaBrowserAdapter,
    injectContentScript,
    sendMessage,
  };
}

describe("ChromeScrollAreaPageAdapter", () => {
  it("scrolls a selected container and returns crop metadata", async () => {
    const current = browser([
      {
        protocolVersion: PROTOCOL_VERSION,
        requestId: "request-1",
        source: "content",
        target: "background",
        type: "SCROLL_AREA_SCROLLED",
        payload: {
          jobId: "job-1",
          descriptor,
          requestedScrollLeft: 0,
          requestedScrollTop: 200,
          actualScrollLeft: 0,
          actualScrollTop: 200,
          scrollWidth: 500,
          scrollHeight: 1000,
          clientWidth: 300,
          clientHeight: 240,
          viewportWidth: 1200,
          viewportHeight: 800,
          devicePixelRatio: 2,
          captureCropCss: { x: 150, y: 100, width: 300, height: 240 },
          hiddenStickyElements: 1,
          stableSamples: 1,
          mutationCount: 0,
          scrollSnapped: false,
          layoutChanged: false,
        },
        sentAt: now.toISOString(),
      },
    ]);
    const adapter = new ChromeScrollAreaPageAdapter(
      current.value,
      () => now,
      () => "request-1",
    );

    await expect(
      adapter.scrollAndSettle({
        tabId: 7,
        jobId: "job-1",
        descriptor,
        scrollLeft: 0,
        scrollTop: 200,
        row: 1,
        column: 0,
        rows: 4,
        columns: 1,
        fixedElementMode: "smart",
        settleMs: 0,
      }),
    ).resolves.toMatchObject({
      actualScrollTop: 200,
      captureCropCss: { x: 150, y: 100, width: 300, height: 240 },
      hiddenStickyElements: 1,
    });
    expect(current.injectContentScript).toHaveBeenCalledWith(7);
    expect(current.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: "SCROLL_AREA_SCROLL" }),
    );
  });
});
