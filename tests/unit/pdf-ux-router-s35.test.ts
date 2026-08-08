import { describe, expect, it, vi } from "vitest";

import { routePdfUxMessage, type PdfUxRouterDependencies } from "@background/pdf-ux-router";
import type { CaptureJob } from "@shared/contracts/domain";
import type { PdfDocumentManifest } from "@shared/contracts/pdf-capture";
import {
  createJobResumeMessage,
  createPdfManifestGetMessage,
} from "@shared/contracts/job-messages";
import { createWebCapError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const NOW = new Date("2026-08-08T12:00:00.000Z");

function pausedJob(options: { activeOutputFormat?: "pdf" } = {}): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-s35-router",
    tabId: 7,
    windowId: 3,
    source: { createdAt: NOW.toISOString() },
    mode: "scroll-area",
    preferredEngine: "scroll",
    activeEngine: "scroll",
    state: "paused",
    stateRevision: 8,
    targetRect: { x: 0, y: 0, width: 640, height: 1720 },
    documentPageMap: {
      schemaVersion: 1,
      strategy: "dom",
      confidence: 0.99,
      complete: true,
      sourcePageCount: 2,
      pages: [
        { index: 0, sourceRectCss: { x: 0, y: 0, width: 640, height: 860 } },
        { index: 1, sourceRectCss: { x: 0, y: 860, width: 640, height: 860 } },
      ],
    },
    tilePlan: [],
    completedTiles: 1,
    totalTiles: 2,
    settings: DEFAULT_CAPTURE_SETTINGS,
    completionPolicy: {
      primaryOutput: "pdf",
      autoExport: true,
      openEditorAfterCapture: false,
      allowGuardedImageFallback: false,
    },
    ...(options.activeOutputFormat === undefined
      ? {}
      : { activeOutputFormat: options.activeOutputFormat }),
    error: createWebCapError({
      code: "E_STORAGE_QUOTA",
      stage: "storage",
      message: "Storage pressure",
      userMessageKey: "errors.storageQuota",
      retryable: true,
      fallbackAllowed: false,
    }),
    cleanup: { attempted: false, completed: false },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: "2026-08-08T12:30:00.000Z",
  };
}

function capturingJob(): CaptureJob {
  return {
    ...pausedJob(),
    state: "capturing",
    stateRevision: 9,
    error: undefined,
  } as CaptureJob;
}

function exportingJob(): CaptureJob {
  return {
    ...pausedJob({ activeOutputFormat: "pdf" }),
    state: "exporting",
    stateRevision: 9,
    error: undefined,
    exportProgress: { completedPages: 1, totalPages: 2 },
  } as CaptureJob;
}

function manifest(): PdfDocumentManifest {
  return {
    schemaVersion: 1,
    revision: 5,
    jobId: "job-s35-router",
    sourceIdentity: "capture-job:job-s35-router",
    sourceStrategy: "semantic-viewer",
    viewerAdapter: "s27-dom",
    expectedPageCount: 2,
    discoveryComplete: true,
    pages: [
      {
        index: 0,
        identity: "page-0",
        sourceRectCss: { x: 0, y: 0, width: 640, height: 860 },
        widthCss: 640,
        heightCss: 860,
        orientation: "portrait",
        discoveryConfidence: 0.99,
        state: "written",
      },
      {
        index: 1,
        identity: "page-1",
        sourceRectCss: { x: 0, y: 860, width: 640, height: 860 },
        widthCss: 640,
        heightCss: 860,
        orientation: "portrait",
        discoveryConfidence: 0.99,
        state: "verified",
      },
    ],
    state: "writing",
    progress: {
      expectedPages: 2,
      discoveredPages: 2,
      capturedPages: 2,
      verifiedPages: 2,
      outputPages: 1,
      currentBatch: 1,
    },
    outputPlan: { kind: "source-order", sourcePageIndexes: [0, 1] },
    outputState: "writing",
    lastVerifiedPage: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: "2026-08-08T12:30:00.000Z",
  };
}

function baseDependencies(job: CaptureJob): PdfUxRouterDependencies {
  return {
    jobs: { get: vi.fn(() => Promise.resolve(job)) },
    manifests: { get: vi.fn(() => Promise.resolve(undefined)) },
    now: () => NOW,
  };
}

describe("S35 PDF UX router", () => {
  it("returns only the durable PDF manifest metadata requested by the popup", async () => {
    const currentManifest = manifest();
    const dependencies = baseDependencies(pausedJob());
    dependencies.manifests.get = vi.fn(() => Promise.resolve(currentManifest));
    const response = await routePdfUxMessage(
      createPdfManifestGetMessage({
        requestId: "manifest-read",
        jobId: "job-s35-router",
        sentAt: NOW.toISOString(),
      }),
      dependencies,
    );

    expect(response).toMatchObject({
      type: "PDF_MANIFEST_RESPONSE",
      requestId: "manifest-read",
      payload: { manifest: currentManifest },
    });
    expect(dependencies.manifests.get).toHaveBeenCalledWith("job-s35-router");
  });

  it("resumes paused streamed PDF output through the existing S33 export path", async () => {
    const paused = pausedJob({ activeOutputFormat: "pdf" });
    const resumed = exportingJob();
    const start = vi.fn(() => Promise.resolve(resumed));
    const dependencies = baseDependencies(paused);
    dependencies.pdfExports = { start };

    const response = await routePdfUxMessage(
      createJobResumeMessage({
        requestId: "resume-output",
        jobId: paused.id,
        sentAt: NOW.toISOString(),
      }),
      dependencies,
    );

    expect(start).toHaveBeenCalledWith(paused.id, paused.settings.pdf);
    expect(response).toMatchObject({
      type: "JOB_RESPONSE",
      requestId: "resume-output",
      payload: { job: { state: "exporting" } },
    });
  });

  it("resumes paused page-native capture without creating a replacement job", async () => {
    const paused = pausedJob();
    const capturing = capturingJob();
    const get = vi
      .fn<() => Promise<CaptureJob | undefined>>()
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce(capturing);
    const start = vi.fn(() => Promise.resolve());
    const startAuto = vi.fn(() => Promise.resolve(capturing));
    const dependencies: PdfUxRouterDependencies = {
      jobs: { get },
      manifests: { get: vi.fn(() => Promise.resolve(undefined)) },
      scrollAreaCaptures: { start },
      completion: { startAuto },
      now: () => NOW,
    };

    const response = await routePdfUxMessage(
      createJobResumeMessage({
        requestId: "resume-capture",
        jobId: paused.id,
        sentAt: NOW.toISOString(),
      }),
      dependencies,
    );

    expect(start).toHaveBeenCalledWith(paused.id);
    expect(response).toMatchObject({
      type: "JOB_RESPONSE",
      requestId: "resume-capture",
      payload: { job: { id: paused.id, state: "capturing" } },
    });
  });
});
