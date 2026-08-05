import { describe, expect, it, vi } from "vitest";

import { TiledImageExportService } from "@background/tiled-image-export-service";
import type { PersistentJobCoordinatorPort } from "@background/job-coordinator";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureJob, CaptureTile, JobState } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const NOW = new Date("2026-08-05T12:00:00.000Z");

function captureTile(): CaptureTile {
  return {
    id: "job-1:0",
    jobId: "job-1",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 20, y: 30, width: 120, height: 80 },
    outputRectCss: { x: 20, y: 30, width: 120, height: 80 },
    expectedPixelWidth: 120,
    expectedPixelHeight: 80,
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
      title: "Selected card",
      origin: "https://example.test",
      createdAt: NOW.toISOString(),
    },
    mode: "region",
    preferredEngine: "cdp",
    activeEngine: "cdp",
    state: "ready",
    stateRevision: 4,
    targetRect: { x: 20, y: 30, width: 120, height: 80 },
    tilePlan: [tile],
    completedTiles: 1,
    totalTiles: 1,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: true, completed: true },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: "2026-08-05T12:30:00.000Z",
  };
}

function artifact(format: "png" | "jpeg" | "webp" = "png"): ArtifactMetadata {
  return {
    artifactId: "image-1",
    sourceArtifactId: "job-1",
    format,
    mimeType: format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp",
    filename: `selected-card.${format === "jpeg" ? "jpg" : format}`,
    byteLength: 500,
    width: 120,
    height: 80,
    createdAt: NOW.toISOString(),
    expiresAt: "2026-08-05T12:30:00.000Z",
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

describe("TiledImageExportService", () => {
  it("returns exporting immediately and completes with durable image metadata", async () => {
    const harness = jobHarness();
    let resolveExport: ((value: ArtifactMetadata) => void) | undefined;
    const exportPromise = new Promise<ArtifactMetadata>((resolve) => {
      resolveExport = resolve;
    });
    const exportTiledImage = vi.fn(() => exportPromise);
    const service = new TiledImageExportService({
      jobs: harness.jobs,
      offscreen: { exportTiledImage },
      now: () => NOW,
      createId: () => "image-1",
    });

    const started = await service.start("job-1", "png");

    expect(started).toMatchObject({
      state: "exporting",
      activeOutputFormat: "png",
      exportProgress: { completedPages: 0, totalPages: 1 },
    });
    expect(exportTiledImage).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        outputArtifactId: "image-1",
        format: "png",
        targetRect: { x: 20, y: 30, width: 120, height: 80 },
      }),
    );

    resolveExport?.(artifact());
    await service.waitForIdle("job-1");

    expect(harness.current()).toMatchObject({
      state: "completed",
      activeOutputFormat: "png",
      outputArtifactId: "image-1",
      output: {
        artifactId: "image-1",
        format: "png",
        mimeType: "image/png",
        byteLength: 500,
        width: 120,
        height: 80,
      },
      exportProgress: { completedPages: 1, totalPages: 1 },
    });
  });

  it("deletes a late artifact when cancellation already returned the job to ready", async () => {
    const harness = jobHarness();
    let resolveExport: ((value: ArtifactMetadata) => void) | undefined;
    const exportPromise = new Promise<ArtifactMetadata>((resolve) => {
      resolveExport = resolve;
    });
    const deleteArtifact = vi.fn(() => Promise.resolve(true));
    const service = new TiledImageExportService({
      jobs: harness.jobs,
      offscreen: { exportTiledImage: () => exportPromise },
      artifacts: { delete: deleteArtifact },
      now: () => NOW,
      createId: () => "image-1",
    });

    await service.start("job-1", "png");
    const cancelled = await service.cancel("job-1");
    expect(cancelled.state).toBe("ready");

    resolveExport?.(artifact());
    await service.waitForIdle("job-1");

    expect(deleteArtifact).toHaveBeenCalledWith("image-1");
    expect(harness.current().state).toBe("ready");
    expect(harness.transitions.map((transition) => transition.state)).toEqual([
      "exporting",
      "ready",
    ]);
  });

  it("preserves the typed oversized-image fallback signal", async () => {
    const harness = jobHarness();
    const service = new TiledImageExportService({
      jobs: harness.jobs,
      offscreen: {
        exportTiledImage: () =>
          Promise.reject(
            createWebCapRuntimeError(
              createWebCapError({
                code: "E_IMAGE_OUTPUT_TOO_LARGE",
                stage: "export",
                message: "The image canvas would exceed the safe browser limit.",
                userMessageKey: "errors.imageOutputTooLarge",
                retryable: true,
                fallbackAllowed: true,
                causeCode: "ImageCanvasDimensionGuard",
              }),
            ),
          ),
      },
      now: () => NOW,
      createId: () => "image-1",
    });

    await service.start("job-1", "png");
    await service.waitForIdle("job-1");

    expect(harness.current()).toMatchObject({
      state: "failed",
      activeOutputFormat: "png",
      error: {
        code: "E_IMAGE_OUTPUT_TOO_LARGE",
        fallbackAllowed: true,
        causeCode: "ImageCanvasDimensionGuard",
      },
    });
  });
});
