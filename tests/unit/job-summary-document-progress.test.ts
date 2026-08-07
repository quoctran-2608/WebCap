import { describe, expect, it } from "vitest";

import { summarizeJob } from "@shared/contracts/job";
import type { CaptureJob, CaptureTile } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const now = "2026-08-07T05:30:00.000Z";

function tile(index: number, x: number, status: CaptureTile["status"]): CaptureTile {
  return {
    id: `job-progress:${index}`,
    jobId: "job-progress",
    index,
    row: 0,
    column: index,
    sourceRectCss: { x, y: 0, width: 100, height: 100 },
    outputRectCss: { x, y: 0, width: 100, height: 100 },
    expectedPixelWidth: 100,
    expectedPixelHeight: 100,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    overlapRightCss: 0,
    overlapBottomCss: 0,
    status,
    attempts: status === "stored" ? 1 : 0,
    ...(status === "stored" ? { byteLength: 100, mimeType: "image/png" as const } : {}),
  };
}

function job(rightStored: boolean): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-progress",
    tabId: 7,
    windowId: 3,
    source: { createdAt: now },
    mode: "scroll-area",
    preferredEngine: "scroll",
    activeEngine: "scroll",
    state: "capturing",
    stateRevision: 2,
    targetRect: { x: 0, y: 0, width: 200, height: 100 },
    documentPageMap: {
      schemaVersion: 1,
      strategy: "dom",
      confidence: 1,
      complete: true,
      sourcePageCount: 1,
      pages: [{ index: 0, sourceRectCss: { x: 0, y: 0, width: 200, height: 100 } }],
    },
    tilePlan: [tile(0, 0, "stored"), tile(1, 100, rightStored ? "stored" : "planned")],
    completedTiles: rightStored ? 2 : 1,
    totalTiles: 2,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: now,
    updatedAt: now,
    expiresAt: "2026-08-07T06:30:00.000Z",
  };
}

describe("document page progress summary", () => {
  it("does not report a page complete when only its vertical extent is covered", () => {
    expect(summarizeJob(job(false))).toMatchObject({
      completedTiles: 1,
      totalTiles: 2,
      completedDocumentPages: 0,
      totalDocumentPages: 1,
    });
  });

  it("reports the page complete after all four corners are covered", () => {
    expect(summarizeJob(job(true))).toMatchObject({
      completedTiles: 2,
      totalTiles: 2,
      completedDocumentPages: 1,
      totalDocumentPages: 1,
    });
  });
});
