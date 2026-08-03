import { describe, expect, it, vi } from "vitest";

import { PdfExportService } from "@background/pdf-export-service";
import type { PersistentJobCoordinatorPort } from "@background/job-coordinator";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureJob, CaptureTile, JobState } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { TileRepositoryPort } from "@storage/tile-repository";

const NOW = new Date("2026-08-03T11:00:00.000Z");

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
    preferredEngine: "cdp",
    activeEngine: "cdp",
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
    expiresAt: "2026-08-03T11:30:00.000Z",
  };
}

function tileRepository(records: StoredTileRecord[]): TileRepositoryPort {
  return {
    put: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    listByJob: () => Promise.resolve(records),
    deleteByJob: () => Promise.resolve(0),
  };
}

function storedRecord(): StoredTileRecord {
  const tile = captureTile();
  return {
    schemaVersion: 1,
    jobId: tile.jobId,
    tileId: tile.id,
    index: tile.index,
    tile,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    createdAt: NOW.toISOString(),
    expiresAt: "2026-08-03T11:30:00.000Z",
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
    update: (_jobId: string, patch: Partial<CaptureJob>) => {
      current = {
        ...current,
        ...patch,
        stateRevision: current.stateRevision + 1,
        updatedAt: NOW.toISOString(),
      };
      return Promise.resolve(structuredClone(current));
    },
  } as unknown as PersistentJobCoordinatorPort;
  return { jobs, current: () => structuredClone(current), transitions };
}

function artifact(pageCount = 3): ArtifactMetadata {
  return {
    artifactId: "pdf-1",
    sourceArtifactId: "job-1",
    format: "pdf",
    mimeType: "application/pdf",
    filename: "report.pdf",
    byteLength: 500,
    width: 595,
    height: 842,
    pageCount,
    createdAt: NOW.toISOString(),
    expiresAt: "2026-08-03T11:30:00.000Z",
  };
}

describe("PdfExportService", () => {
  it("returns exporting immediately, persists monotonic progress, and completes asynchronously", async () => {
    const harness = jobHarness();
    let resolveExport: ((value: ArtifactMetadata) => void) | undefined;
    const exportPromise = new Promise<ArtifactMetadata>((resolve) => {
      resolveExport = resolve;
    });
    const exportPdf = vi.fn(() => exportPromise);
    const service = new PdfExportService({
      jobs: harness.jobs,
      tiles: tileRepository([storedRecord()]),
      offscreen: { exportPdf },
      now: () => NOW,
      createId: () => "pdf-1",
    });

    const started = await service.start("job-1");

    expect(started.state).toBe("exporting");
    expect(started.exportProgress).toEqual({ completedPages: 0, totalPages: 3 });
    expect(exportPdf).toHaveBeenCalledOnce();
    await service.handleProgress({ jobId: "job-1", completedPages: 1, totalPages: 3 });
    await service.handleProgress({ jobId: "job-1", completedPages: 0, totalPages: 3 });
    expect(harness.current().exportProgress).toEqual({ completedPages: 1, totalPages: 3 });

    expect(resolveExport).toBeDefined();
    resolveExport?.(artifact());
    await vi.waitFor(() => expect(harness.current().state).toBe("completed"));
    expect(harness.current()).toMatchObject({
      state: "completed",
      outputArtifactId: "pdf-1",
      exportProgress: { completedPages: 3, totalPages: 3 },
    });
    expect(harness.transitions.map((transition) => transition.state)).toEqual([
      "exporting",
      "completed",
    ]);
  });

  it("normalizes an offscreen failure while preserving the stored source tiles", async () => {
    const harness = jobHarness();
    const records = [storedRecord()];
    const repository = tileRepository(records);
    const service = new PdfExportService({
      jobs: harness.jobs,
      tiles: repository,
      offscreen: { exportPdf: () => Promise.reject(new Error("JPEG encoding failed")) },
      now: () => NOW,
      createId: () => "pdf-1",
    });

    await service.start("job-1");
    await vi.waitFor(() => expect(harness.current().state).toBe("failed"));

    expect(harness.current().error).toMatchObject({
      code: "E_EXPORT_FAILED",
      stage: "export",
      retryable: true,
    });
    expect(await repository.listByJob("job-1")).toHaveLength(1);
  });

  it("rejects export before offscreen work when a captured tile is unavailable", async () => {
    const harness = jobHarness();
    const exportPdf = vi.fn(() => Promise.resolve(artifact()));
    const service = new PdfExportService({
      jobs: harness.jobs,
      tiles: tileRepository([]),
      offscreen: { exportPdf },
      now: () => NOW,
      createId: () => "pdf-1",
    });

    await expect(service.start("job-1")).rejects.toMatchObject({ name: "E_STORAGE_READ" });
    expect(exportPdf).not.toHaveBeenCalled();
    expect(harness.current().state).toBe("ready");
  });
});
