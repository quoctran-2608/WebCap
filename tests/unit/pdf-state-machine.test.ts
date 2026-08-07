import { describe, expect, it } from "vitest";

import {
  derivePdfPageProgress,
  transitionPdfManifest,
  updatePdfManifest,
  validatePdfManifestInvariants,
} from "@background/pdf-state-machine";
import type { PdfDocumentManifest, PdfPageManifest } from "@shared/contracts/pdf-capture";

const timestamp = "2026-08-07T12:00:00.000Z";
const nextTimestamp = "2026-08-07T12:01:00.000Z";

function pages(state: PdfPageManifest["state"] = "verified"): PdfPageManifest[] {
  return [
    {
      index: 0,
      identity: "page-0",
      sourceRectCss: { x: 10, y: 10, width: 100, height: 140 },
      widthCss: 100,
      heightCss: 140,
      orientation: "portrait",
      discoveryConfidence: 1,
      state,
    },
    {
      index: 1,
      identity: "page-1",
      sourceRectCss: { x: 10, y: 170, width: 100, height: 140 },
      widthCss: 100,
      heightCss: 140,
      orientation: "portrait",
      discoveryConfidence: 1,
      state,
    },
  ];
}

function manifest(state: PdfDocumentManifest["state"] = "writing"): PdfDocumentManifest {
  const sourcePages = pages("verified");
  return {
    schemaVersion: 1,
    revision: 0,
    jobId: "job-1",
    sourceIdentity: "capture-job:job-1",
    sourceStrategy: "semantic-viewer",
    viewerAdapter: "s27-dom",
    expectedPageCount: 2,
    discoveryComplete: true,
    pages: sourcePages,
    state,
    progress: derivePdfPageProgress(sourcePages, 2, 0),
    outputState: "writing",
    lastVerifiedPage: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: "2026-08-07T12:30:00.000Z",
  };
}

describe("PDF state machine", () => {
  it("requires exact written-page agreement before completion", () => {
    const source = manifest();
    const result = transitionPdfManifest(source, "completed", nextTimestamp, {
      outputState: "completed",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { causeCode: "PdfCompletionUnverified" },
    });

    const written = pages("written");
    const complete = transitionPdfManifest(source, "completed", nextTimestamp, {
      pages: written,
      progress: derivePdfPageProgress(written, 2, 0),
      outputState: "completed",
    });
    expect(complete).toMatchObject({
      ok: true,
      value: {
        state: "completed",
        progress: { discoveredPages: 2, capturedPages: 2, verifiedPages: 2, outputPages: 2 },
      },
    });
  });

  it("rejects page lifecycle regression", () => {
    const source = manifest();
    const regressed = pages("captured");
    const result = updatePdfManifest(source, nextTimestamp, {
      pages: regressed,
      progress: derivePdfPageProgress(regressed, 2, 0),
      lastVerifiedPage: undefined,
    } as never);

    expect(result).toMatchObject({
      ok: false,
      error: { causeCode: "PdfPageStateRegressed" },
    });
  });

  it("rejects progress that is not derived from page state", () => {
    const source = manifest();
    const candidate = {
      ...source,
      progress: { ...source.progress, outputPages: 1 },
    };
    expect(validatePdfManifestInvariants(candidate)).toMatchObject({
      ok: false,
      error: { causeCode: "PdfProgressDrift" },
    });
  });

  it("rejects duplicate page identity and index gaps", () => {
    const duplicate = manifest();
    duplicate.pages[1] = { ...duplicate.pages[1]!, identity: "page-0" };
    expect(validatePdfManifestInvariants(duplicate)).toMatchObject({
      ok: false,
      error: { causeCode: "PdfPageIdentityDuplicate" },
    });

    const gap = manifest();
    gap.pages[1] = { ...gap.pages[1]!, index: 2 };
    expect(validatePdfManifestInvariants(gap)).toMatchObject({
      ok: false,
      error: { causeCode: "PdfPageIndexGap" },
    });
  });
});
