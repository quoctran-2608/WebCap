import { describe, expect, it } from "vitest";

import type { CaptureJob, CaptureTile } from "@shared/contracts/domain";
import type { PdfDocumentManifest } from "@shared/contracts/pdf-capture";
import { createWebCapError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import { buildPdfUxSnapshot, pdfUxCopy } from "@popup/pdf-ux";

const now = "2026-08-08T12:00:00.000Z";

function tile(index: number, y: number): CaptureTile {
  return {
    id: `tile-${index}`,
    jobId: "job-s35",
    index,
    row: index,
    column: 0,
    sourceRectCss: { x: 0, y, width: 100, height: 100 },
    outputRectCss: { x: 0, y, width: 100, height: 100 },
    expectedPixelWidth: 100,
    expectedPixelHeight: 100,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    status: "stored",
    attempts: 1,
  };
}

function viewerJob(state: CaptureJob["state"] = "completed"): CaptureJob {
  const tiles = [tile(0, 0), tile(1, 100)];
  return {
    schemaVersion: 1,
    id: "job-s35",
    tabId: 7,
    windowId: 3,
    source: { createdAt: now },
    mode: "scroll-area",
    preferredEngine: "scroll",
    activeEngine: "scroll",
    state,
    stateRevision: 12,
    metrics: {
      document: { x: 0, y: 0, width: 100, height: 200 },
      layoutViewport: { x: 0, y: 0, width: 100, height: 100 },
      visualViewport: { x: 0, y: 0, width: 100, height: 100, scale: 1 },
      devicePixelRatio: 1,
      zoomFactor: 1,
      scrollX: 0,
      scrollY: 0,
    },
    targetRect: { x: 0, y: 0, width: 100, height: 200 },
    documentPageMap: {
      schemaVersion: 1,
      strategy: "dom",
      confidence: 0.99,
      complete: true,
      sourcePageCount: 2,
      pages: [
        { index: 0, sourceRectCss: { x: 0, y: 0, width: 100, height: 100 } },
        { index: 1, sourceRectCss: { x: 0, y: 100, width: 100, height: 100 } },
      ],
    },
    tilePlan: tiles,
    completedTiles: 2,
    totalTiles: 2,
    settings: DEFAULT_CAPTURE_SETTINGS,
    completionPolicy: {
      primaryOutput: "pdf",
      autoExport: true,
      openEditorAfterCapture: false,
      allowGuardedImageFallback: false,
    },
    activeOutputFormat: "pdf",
    output:
      state === "completed"
        ? {
            artifactId: "artifact-s35",
            sourceArtifactId: "job-s35",
            format: "pdf",
            mimeType: "application/pdf",
            filename: "fixture.pdf",
            byteLength: 1000,
            width: 100,
            height: 100,
            pageCount: 2,
            createdAt: now,
            expiresAt: "2026-08-08T12:30:00.000Z",
          }
        : undefined,
    cleanup: { attempted: true, completed: true },
    exportProgress: { completedPages: state === "completed" ? 2 : 1, totalPages: 2 },
    outputArtifactId: "artifact-s35",
    createdAt: now,
    updatedAt: now,
    expiresAt: "2026-08-08T12:30:00.000Z",
  };
}

function manifest(state: PdfDocumentManifest["state"] = "completed"): PdfDocumentManifest {
  return {
    schemaVersion: 1,
    revision: 6,
    jobId: "job-s35",
    sourceIdentity: "capture-job:job-s35",
    sourceStrategy: "semantic-viewer",
    viewerAdapter: "s27-dom",
    expectedPageCount: 2,
    discoveryComplete: true,
    pages: [
      {
        index: 0,
        identity: "page-0",
        sourceRectCss: { x: 0, y: 0, width: 100, height: 100 },
        widthCss: 100,
        heightCss: 100,
        orientation: "portrait",
        discoveryConfidence: 0.99,
        state: "written",
      },
      {
        index: 1,
        identity: "page-1",
        sourceRectCss: { x: 0, y: 100, width: 100, height: 100 },
        widthCss: 100,
        heightCss: 100,
        orientation: "portrait",
        discoveryConfidence: 0.99,
        state: "written",
      },
    ],
    state,
    progress: {
      expectedPages: 2,
      discoveredPages: 2,
      capturedPages: 2,
      verifiedPages: 2,
      outputPages: state === "completed" ? 2 : 1,
      currentBatch: 1,
    },
    outputPlan: { kind: "source-order", sourcePageIndexes: [0, 1] },
    outputState: state === "completed" ? "completed" : "writing",
    lastVerifiedPage: 1,
    createdAt: now,
    updatedAt: now,
    expiresAt: "2026-08-08T12:30:00.000Z",
  };
}

describe("S35 PDF UX", () => {
  it("shows verified completion only after manifest agreement", () => {
    const snapshot = buildPdfUxSnapshot(viewerJob(), manifest());
    expect(snapshot).toMatchObject({
      dedicatedViewer: true,
      stage: "completed",
      completedPages: 2,
      totalPages: 2,
      percent: 100,
      verifiedComplete: true,
      resultKind: "viewer",
    });
  });

  it("falls back to durable job export progress when a legacy job has no manifest", () => {
    const job = viewerJob("exporting");
    const snapshot = buildPdfUxSnapshot(job);
    expect(snapshot.stage).toBe("writing");
    expect(snapshot.completedPages).toBe(1);
    expect(snapshot.totalPages).toBe(2);
    expect(snapshot.verifiedComplete).toBe(false);
  });

  it("offers resume only for retryable paused PDF work", () => {
    const job = viewerJob("paused");
    job.error = createWebCapError({
      code: "E_STORAGE_QUOTA",
      stage: "storage",
      message: "Storage pressure",
      userMessageKey: "errors.storageQuota",
      retryable: true,
      fallbackAllowed: false,
    });
    const snapshot = buildPdfUxSnapshot(job, manifest("paused"));
    expect(snapshot.stage).toBe("paused");
    expect(snapshot.canResume).toBe(true);
  });

  it("keeps the new PDF UX localized without changing stored settings", () => {
    expect(pdfUxCopy("vi", "verified", { completed: 126, total: 126 })).toContain(
      "126/126 trang đã xác minh",
    );
    expect(pdfUxCopy("en", "verified", { completed: 126, total: 126 })).toContain(
      "126/126 pages verified",
    );
  });
});
