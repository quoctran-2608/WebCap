import { describe, expect, it, vi } from "vitest";

import { CaptureCompletionService } from "@background/capture-completion-service";
import type { PersistentJobCoordinatorPort } from "@background/job-coordinator";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureJob, CaptureTile, JobState } from "@shared/contracts/domain";
import { createWebCapError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const NOW = new Date("2026-08-05T12:30:00.000Z");

function captureTile(): CaptureTile {
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
    overlapRightCss: 0,
    overlapBottomCss: 0,
    status: "stored",
    attempts: 1,
    byteLength: 3,
    mimeType: "image/png",
  };
}

function readyJob(): CaptureJob {
  const tile = captureTile();
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: {
      title: "Long report",
      origin: "https://example.test",
      createdAt: NOW.toISOString(),
    },
    mode: "full-page",
    preferredEngine: "scroll",
    activeEngine: "scroll",
    state: "ready",
    stateRevision: 4,
    targetRect: { x: 0, y: 0, width: 100, height: 300 },
    tilePlan: [tile],
    completedTiles: 1,
    totalTiles: 1,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: true, completed: true },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: "2026-08-05T13:00:00.000Z",
  };
}

function restartFailedJob(): CaptureJob {
  return {
    ...readyJob(),
    state: "failed",
    stateRevision: 5,
    error: createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message: "The service worker restarted during export.",
      userMessageKey: "errors.exportFailed",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "ServiceWorkerRestart",
    }),
  };
}

function outputArtifact(): ArtifactRecord {
  return {
    artifactId: "pdf-1",
    sourceArtifactId: "job-1",
    jobId: "job-1",
    role: "output",
    format: "pdf",
    mimeType: "application/pdf",
    filename: "long-report.pdf",
    byteLength: 500,
    width: 595,
    height: 842,
    pageCount: 3,
    createdAt: NOW.toISOString(),
    expiresAt: "2026-08-05T13:00:00.000Z",
    blob: new Blob([new Uint8Array([37, 80, 68, 70, 45])], { type: "application/pdf" }),
  };
}

function jobHarness(initial = readyJob()): {
  jobs: PersistentJobCoordinatorPort;
  current: () => CaptureJob;
  transitions: Array<{ state: JobState; patch: Partial<CaptureJob> }>;
} {
  let current = structuredClone(initial);
  const transitions: Array<{ state: JobState; patch: Partial<CaptureJob> }> = [];
  const jobs = {
    get: () => Promise.resolve(structuredClone(current)),
    listActive: () => Promise.resolve([structuredClone(current)]),
    transition: (_jobId: string, state: JobState, patch: Partial<CaptureJob> = {}) => {
      transitions.push({ state, patch });
      current = {
        ...current,
        ...patch,
        state,
        stateRevision: current.stateRevision + 1,
        updatedAt: NOW.toISOString(),
      };
      return Promise.resolve(structuredClone(current));
    },
  } as unknown as PersistentJobCoordinatorPort;
  return { jobs, current: () => structuredClone(current), transitions };
}

function outputPorts(harness: ReturnType<typeof jobHarness>) {
  const pdfStart = vi.fn(() =>
    harness.jobs.transition(
      "job-1",
      "exporting",
      {
        activeOutputFormat: "pdf",
        exportProgress: { completedPages: 0, totalPages: 3 },
      },
      { sourceArtifactExists: true },
    ),
  );
  const imageStart = vi.fn(() => Promise.resolve(harness.current()));
  return {
    pdfStart,
    imageStart,
    pdf: {
      start: pdfStart,
      cancel: () => Promise.resolve(harness.current()),
      waitForIdle: () => Promise.resolve(),
    },
    images: {
      start: imageStart,
      cancel: () => Promise.resolve(harness.current()),
      waitForIdle: () => Promise.resolve(),
    },
  };
}

describe("CaptureCompletionService", () => {
  it("reconciles an existing output artifact exactly once after restart", async () => {
    const harness = jobHarness();
    const ports = outputPorts(harness);
    const listByJob = vi.fn(() => Promise.resolve([outputArtifact()]));
    const service = new CaptureCompletionService({
      jobs: harness.jobs,
      pdf: ports.pdf,
      images: ports.images,
      artifacts: { listByJob },
    });

    const recovered = await service.recover("job-1");
    const repeated = await service.recover("job-1");

    expect(recovered).toMatchObject({
      state: "completed",
      activeOutputFormat: "pdf",
      outputArtifactId: "pdf-1",
      output: {
        artifactId: "pdf-1",
        format: "pdf",
        pageCount: 3,
      },
      exportProgress: { completedPages: 3, totalPages: 3 },
    });
    expect(repeated.state).toBe("completed");
    expect(ports.pdfStart).not.toHaveBeenCalled();
    expect(ports.imageStart).not.toHaveBeenCalled();
    expect(harness.transitions.map((transition) => transition.state)).toEqual([
      "exporting",
      "completed",
    ]);
    expect(listByJob).toHaveBeenCalledOnce();
  });

  it("restarts an interrupted automatic PDF export only once", async () => {
    const harness = jobHarness(restartFailedJob());
    const ports = outputPorts(harness);
    const service = new CaptureCompletionService({
      jobs: harness.jobs,
      pdf: ports.pdf,
      images: ports.images,
      artifacts: { listByJob: () => Promise.resolve([]) },
    });

    const first = await service.recover("job-1");
    const second = await service.recover("job-1");

    expect(first.state).toBe("exporting");
    expect(second.state).toBe("exporting");
    expect(ports.pdfStart).toHaveBeenCalledOnce();
    expect(ports.imageStart).not.toHaveBeenCalled();
  });

  it("does not automatically export a guard-limited partial capture", async () => {
    const harness = jobHarness({
      ...readyJob(),
      partialCapture: {
        reason: "max-tiles",
        capturedRect: { x: 0, y: 0, width: 100, height: 300 },
        limitValue: 2,
      },
    });
    const ports = outputPorts(harness);
    const service = new CaptureCompletionService({
      jobs: harness.jobs,
      pdf: ports.pdf,
      images: ports.images,
      artifacts: { listByJob: () => Promise.resolve([]) },
    });

    const result = await service.startAuto("job-1");

    expect(result.state).toBe("ready");
    expect(ports.pdfStart).not.toHaveBeenCalled();
    await expect(service.start("job-1")).rejects.toMatchObject({
      causeCode: "PartialOutputConfirmationRequired",
    });
  });
});
