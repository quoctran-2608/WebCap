import { describe, expect, it } from "vitest";

import { transitionJob } from "@background/job-state-machine";
import type { CaptureJob, CaptureTile } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const createdAt = "2026-08-07T12:00:00.000Z";
const updatedAt = "2026-08-07T12:01:00.000Z";
const expiresAt = "2026-08-07T12:30:00.000Z";

function storedTile(): CaptureTile {
  return {
    id: "job-1:0",
    jobId: "job-1",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 0, y: 0, width: 100, height: 300 },
    outputRectCss: { x: 0, y: 0, width: 100, height: 300 },
    expectedPixelWidth: 100,
    expectedPixelHeight: 300,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    status: "stored",
    attempts: 1,
  };
}

function exportingPdfJob(sourcePageCount = 1, outputPageCount = 1): CaptureJob {
  const tile = storedTile();
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { createdAt },
    mode: "scroll-area",
    preferredEngine: "scroll",
    activeEngine: "scroll",
    state: "exporting",
    stateRevision: 5,
    targetRect: { x: 0, y: 0, width: 100, height: 300 },
    documentPageMap: {
      schemaVersion: 1,
      strategy: "dom",
      confidence: 1,
      complete: true,
      sourcePageCount,
      pages: Array.from({ length: sourcePageCount }, (_, index) => ({
        index,
        sourceRectCss: { x: 0, y: index * 150, width: 100, height: 140 },
      })),
    },
    tilePlan: [tile],
    completedTiles: 1,
    totalTiles: 1,
    settings: DEFAULT_CAPTURE_SETTINGS,
    activeOutputFormat: "pdf",
    exportProgress: { completedPages: 0, totalPages: outputPageCount },
    cleanup: { attempted: true, completed: true },
    createdAt,
    updatedAt: createdAt,
    expiresAt,
  };
}

const output = {
  artifactId: "pdf-1",
  sourceArtifactId: "job-1",
  format: "pdf" as const,
  mimeType: "application/pdf",
  filename: "document.pdf",
  byteLength: 500,
  width: 595,
  height: 842,
  pageCount: 1,
  createdAt,
  expiresAt,
};

describe("dedicated PDF completion evidence", () => {
  it("rejects a completed page-aware PDF without manifest evidence", () => {
    const result = transitionJob(exportingPdfJob(), "completed", updatedAt, {
      output,
      outputArtifactId: output.artifactId,
      exportProgress: { completedPages: 1, totalPages: 1 },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { causeCode: "PdfCompletionEvidenceMissing" },
    });
  });

  it("accepts completion only when structured verified evidence agrees", () => {
    const result = transitionJob(
      exportingPdfJob(),
      "completed",
      updatedAt,
      {
        output,
        outputArtifactId: output.artifactId,
        exportProgress: { completedPages: 1, totalPages: 1 },
      },
      {
        pdfCompletionEvidence: {
          schemaVersion: 1,
          jobId: "job-1",
          manifestRevision: 4,
          sourcePageCount: 1,
          expectedOutputPageCount: 1,
          outputPageCount: 1,
          verified: true,
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: { state: "completed", output: { pageCount: 1 } },
    });
  });

  it("allows an explicitly verified edited output count after all source pages are verified", () => {
    const result = transitionJob(
      exportingPdfJob(2, 1),
      "completed",
      updatedAt,
      {
        output,
        outputArtifactId: output.artifactId,
        exportProgress: { completedPages: 1, totalPages: 1 },
      },
      {
        pdfCompletionEvidence: {
          schemaVersion: 1,
          jobId: "job-1",
          manifestRevision: 9,
          sourcePageCount: 2,
          expectedOutputPageCount: 1,
          outputPageCount: 1,
          verified: true,
        },
      },
    );

    expect(result).toMatchObject({ ok: true, value: { state: "completed" } });
  });
});
