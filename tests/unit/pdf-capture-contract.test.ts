import { describe, expect, it } from "vitest";

import {
  PdfDocumentManifestSchema,
  PdfStrategyDecisionSchema,
} from "@shared/contracts/pdf-capture";

const timestamp = "2026-08-07T12:00:00.000Z";

function validManifest() {
  return {
    schemaVersion: 1 as const,
    revision: 0,
    jobId: "job-1",
    sourceIdentity: "capture-job:job-1",
    sourceStrategy: "semantic-viewer" as const,
    viewerAdapter: "s27-dom",
    expectedPageCount: 2,
    discoveryComplete: true,
    pages: [
      {
        index: 0,
        identity: "page-0",
        sourceRectCss: { x: 10, y: 10, width: 100, height: 140 },
        widthCss: 100,
        heightCss: 140,
        orientation: "portrait" as const,
        discoveryConfidence: 1,
        state: "verified" as const,
      },
      {
        index: 1,
        identity: "page-1",
        sourceRectCss: { x: 10, y: 170, width: 140, height: 100 },
        widthCss: 140,
        heightCss: 100,
        orientation: "landscape" as const,
        discoveryConfidence: 0.98,
        state: "verified" as const,
      },
    ],
    state: "writing" as const,
    progress: {
      expectedPages: 2,
      discoveredPages: 2,
      capturedPages: 2,
      verifiedPages: 2,
      outputPages: 0,
      currentBatch: 0,
    },
    outputState: "writing" as const,
    lastVerifiedPage: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: "2026-08-07T12:30:00.000Z",
  };
}

describe("PDF capture contracts", () => {
  it("accepts a page-oriented durable document manifest", () => {
    expect(PdfDocumentManifestSchema.parse(validManifest())).toMatchObject({
      expectedPageCount: 2,
      progress: {
        discoveredPages: 2,
        capturedPages: 2,
        verifiedPages: 2,
        outputPages: 0,
      },
    });
  });

  it("keeps strategy negotiation independent of tile planning", () => {
    const decision = PdfStrategyDecisionSchema.parse({
      schemaVersion: 1,
      primaryStrategy: "original-source",
      fallbackStrategies: ["semantic-viewer", "visual-discovery"],
      reason: "original-available",
      canDownloadOriginal: true,
      canCaptureViewer: true,
    });
    expect(decision.primaryStrategy).toBe("original-source");
    expect(decision).not.toHaveProperty("maxTiles");
  });

  it("rejects zero-size logical page geometry", () => {
    const candidate = validManifest();
    candidate.pages[0] = {
      ...candidate.pages[0],
      sourceRectCss: { x: 0, y: 0, width: 0, height: 140 },
    };
    expect(PdfDocumentManifestSchema.safeParse(candidate).success).toBe(false);
  });
});
