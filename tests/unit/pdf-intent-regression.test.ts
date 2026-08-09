import { describe, expect, it } from "vitest";

import type { CaptureJob } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import { buildPdfUxSnapshot, isDedicatedViewerPdfJob } from "@popup/pdf-ux";

function job(outputFormat: "png" | "pdf", state: CaptureJob["state"]): CaptureJob {
  const now = "2026-08-09T13:00:00.000Z";
  return {
    schemaVersion: 1,
    id: `job-${outputFormat}`,
    tabId: 1,
    windowId: 1,
    source: { createdAt: now },
    mode: "scroll-area",
    preferredEngine: "scroll",
    state,
    stateRevision: 1,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: { ...DEFAULT_CAPTURE_SETTINGS, outputFormat },
    completionPolicy: {
      primaryOutput: "pdf",
      autoExport: true,
      openEditorAfterCapture: false,
      allowGuardedImageFallback: outputFormat !== "pdf",
    },
    cleanup: { attempted: false, completed: false },
    createdAt: now,
    updatedAt: now,
    expiresAt: "2026-08-09T14:00:00.000Z",
  };
}

describe("explicit PDF viewer intent", () => {
  it("is durable before discovery has produced a document page map", () => {
    const pdfJob = job("pdf", "created");
    expect(pdfJob.documentPageMap).toBeUndefined();
    expect(isDedicatedViewerPdfJob(pdfJob)).toBe(true);
  });

  it("does not misclassify ordinary scroll-area capture as dedicated PDF", () => {
    expect(isDedicatedViewerPdfJob(job("png", "created"))).toBe(false);
  });

  it("shows a failed PDF stage instead of pretending capture is still running", () => {
    expect(buildPdfUxSnapshot(job("pdf", "failed")).stage).toBe("failed");
  });
});
