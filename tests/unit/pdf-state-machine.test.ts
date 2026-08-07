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
    outputPlan: { kind: "source-order", sourcePageIndexes: [0, 1] },
    outputState: "writing",
    lastVerifiedPage: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: "2026-08-07T12:30:00.000Z",
  };
}

describe("PDF state machine", () => {
  it("requires exact source verification and output-plan agreement before completion", () => {
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
      progress: derivePdfPageProgress(written, 2, 0, undefined, 2),
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

  it("allows a verified editor subset without pretending source verification is partial", () => {
    const source = manifest();
    const editedPages = [source.pages[0]!, { ...source.pages[1]!, state: "written" as const }];
    const complete = transitionPdfManifest(source, "completed", nextTimestamp, {
      pages: editedPages,
      outputPlan: { kind: "editor", sourcePageIndexes: [1], editRevision: 3 },
      progress: derivePdfPageProgress(editedPages, 2, 0, undefined, 1),
      outputState: "completed",
    });

    expect(complete).toMatchObject({
      ok: true,
      value: {
        progress: { verifiedPages: 2, outputPages: 1 },
        outputPlan: { kind: "editor", sourcePageIndexes: [1], editRevision: 3 },
      },
    });
  });

  it("allows replanning before writing resumes but blocks plan changes mid-write", () => {
    const paused = manifest("paused");
    const replanned = transitionPdfManifest(paused, "verifying", nextTimestamp, {
      outputPlan: { kind: "editor", sourcePageIndexes: [1], editRevision: 4 },
      outputState: "not-started",
    });
    expect(replanned).toMatchObject({
      ok: true,
      value: {
        state: "verifying",
        outputPlan: { kind: "editor", sourcePageIndexes: [1], editRevision: 4 },
      },
    });

    const writing = manifest("writing");
    const changedMidWrite = updatePdfManifest(writing, nextTimestamp, {
      outputPlan: { kind: "editor", sourcePageIndexes: [1], editRevision: 4 },
    });
    expect(changedMidWrite).toMatchObject({
      ok: false,
      error: { causeCode: "PdfOutputPlanChanged" },
    });
  });

  it("rejects page lifecycle regression", () => {
    const source = manifest();
    const regressed = pages("captured");
    const result = updatePdfManifest(source, nextTimestamp, {
      pages: regressed,
      progress: derivePdfPageProgress(regressed, 2, 0),
      lastVerifiedPage: undefined,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { causeCode: "PdfPageStateRegressed" },
    });
  });

  it("rejects source progress that is not derived from page state", () => {
    const source = manifest();
    const candidate = {
      ...source,
      progress: { ...source.progress, capturedPages: 1 },
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
