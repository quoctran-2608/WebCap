import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "@shared/constants";
import {
  ScrollAreaCleanedMessageSchema,
  ScrollAreaScrolledMessageSchema,
  createScrollAreaCleanupMessage,
  createScrollAreaScrollMessage,
  parseScrollAreaCleanupResponse,
  parseScrollAreaScrollResponse,
} from "@shared/contracts/scroll-area";

const sentAt = "2026-08-04T03:00:00.000Z";
const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "scroll-selection",
  tagName: "section",
  classNames: ["messages"],
  scrollable: true,
  captureKind: "full-scroll-content" as const,
};

describe("scroll-area protocol", () => {
  it("creates metadata-only scroll and cleanup requests", () => {
    expect(
      createScrollAreaScrollMessage({
        requestId: "scroll-1",
        sentAt,
        jobId: "job-1",
        descriptor,
        scrollLeft: 20,
        scrollTop: 300,
        row: 1,
        column: 0,
        rows: 3,
        columns: 1,
        fixedElementMode: "smart",
        settleMs: 25,
      }),
    ).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      type: "SCROLL_AREA_SCROLL",
      payload: { jobId: "job-1", scrollTop: 300, descriptor },
    });
    expect(
      createScrollAreaCleanupMessage({
        requestId: "cleanup-1",
        sentAt,
        jobId: "job-1",
        descriptor,
      }),
    ).toMatchObject({ type: "SCROLL_AREA_CLEANUP", payload: { descriptor } });
  });

  it("rejects cleanup requests for visible-bounds targets", () => {
    expect(() =>
      createScrollAreaCleanupMessage({
        requestId: "cleanup-visible",
        sentAt,
        jobId: "job-1",
        descriptor: { ...descriptor, captureKind: "visible-bounds" },
      }),
    ).toThrow();
  });

  it("parses matching scroll and cleanup responses", () => {
    const scrolled = ScrollAreaScrolledMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "scroll-1",
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
        scrollWidth: 600,
        scrollHeight: 1200,
        clientWidth: 300,
        clientHeight: 240,
        viewportWidth: 1000,
        viewportHeight: 700,
        devicePixelRatio: 2,
        captureCropCss: { x: 100, y: 80, width: 300, height: 240 },
        hiddenStickyElements: 1,
        stableSamples: 1,
        mutationCount: 0,
        scrollSnapped: false,
        layoutChanged: false,
      },
      sentAt,
    });
    expect(parseScrollAreaScrollResponse(scrolled, "scroll-1")).toEqual({
      ok: true,
      value: scrolled,
    });

    const cleaned = ScrollAreaCleanedMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cleanup-1",
      source: "content",
      target: "background",
      type: "SCROLL_AREA_CLEANED",
      payload: {
        jobId: "job-1",
        restoredElements: 1,
        skippedElements: 0,
        scrollRestored: true,
        documentScrollRestored: true,
      },
      sentAt,
    });
    expect(parseScrollAreaCleanupResponse(cleaned, "cleanup-1")).toEqual({
      ok: true,
      value: cleaned,
    });
  });
});
