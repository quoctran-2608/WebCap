import { describe, expect, it, vi } from "vitest";

import { PdfExportService } from "@background/pdf-export-service";
import type { PersistentJobCoordinatorPort } from "@background/job-coordinator";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureJob, CaptureTile, JobState } from "@shared/contracts/domain";
import type { PdfEditManifest } from "@shared/contracts/pdf-editor";
import type { StoredTileRecord } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

const NOW = new Date("2026-08-03T13:45:00.000Z");

function tile(): CaptureTile {
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

function job(): CaptureJob {
  const sourceTile = tile();
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { title: "Editor source", createdAt: NOW.toISOString() },
    mode: "full-page",
    preferredEngine: "cdp",
    activeEngine: "cdp",
    state: "ready",
    stateRevision: 4,
    targetRect: { x: 0, y: 0, width: 100, height: 300 },
    tilePlan: [sourceTile],
    completedTiles: 1,
    totalTiles: 1,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: true, completed: true },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: "2026-08-03T14:15:00.000Z",
  };
}

function harness(): {
  jobs: PersistentJobCoordinatorPort;
  current: () => CaptureJob;
} {
  let current = structuredClone(job());
  const jobs = {
    get: () => Promise.resolve(structuredClone(current)),
    transition: (_jobId: string, state: JobState, patch: Partial<CaptureJob> = {}) => {
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
  return { jobs, current: () => structuredClone(current) };
}

function storedTileRepository(): TileRepositoryPort & { records: StoredTileRecord[] } {
  const sourceTile = tile();
  const records: StoredTileRecord[] = [
    {
      schemaVersion: 1,
      jobId: sourceTile.jobId,
      index: sourceTile.index,
      tile: sourceTile,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    },
  ];
  return {
    records,
    put: () => Promise.resolve(),
    get: () => Promise.resolve(records[0]),
    listByJob: () => Promise.resolve(records),
    deleteByJob: () => Promise.resolve(0),
  };
}

function manifestRepository(): PdfEditManifestRepositoryPort {
  const manifest: PdfEditManifest = {
    schemaVersion: 1,
    jobId: "job-1",
    revision: 2,
    settings: { ...DEFAULT_CAPTURE_SETTINGS.pdf, jpegQuality: 0.7 },
    pages: [
      {
        id: "page-3",
        originalIndex: 2,
        sourceRectCss: { x: 0, y: 200, width: 100, height: 100 },
        pageWidthPt: 595,
        pageHeightPt: 842,
        imageRectPt: { x: 20, y: 20, width: 555, height: 802 },
      },
      {
        id: "page-1",
        originalIndex: 0,
        sourceRectCss: { x: 0, y: 0, width: 100, height: 100 },
        pageWidthPt: 595,
        pageHeightPt: 842,
        imageRectPt: { x: 20, y: 20, width: 555, height: 802 },
      },
    ],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: "2026-08-03T14:15:00.000Z",
  };
  return {
    load: () => Promise.resolve(structuredClone(manifest)),
    save: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

function artifact(id = "pdf-1"): ArtifactMetadata {
  return {
    artifactId: id,
    sourceArtifactId: "job-1",
    format: "pdf",
    mimeType: "application/pdf",
    filename: "editor.pdf",
    byteLength: 500,
    width: 595,
    height: 842,
    pageCount: 2,
    createdAt: NOW.toISOString(),
    expiresAt: "2026-08-03T14:15:00.000Z",
  };
}

describe("PdfExportService editor lifecycle", () => {
  it("uses the saved page subset and order and cancels back to ready without deleting source tiles", async () => {
    const state = harness();
    const tiles = storedTileRepository();
    let resolveExport: ((value: ArtifactMetadata) => void) | undefined;
    const exportPdf = vi.fn(
      () =>
        new Promise<ArtifactMetadata>((resolve) => {
          resolveExport = resolve;
        }),
    );
    const service = new PdfExportService({
      jobs: state.jobs,
      tiles,
      offscreen: { exportPdf },
      manifests: manifestRepository(),
      now: () => NOW,
      createId: () => "pdf-1",
    });

    await service.start("job-1");
    expect(exportPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        pages: expect.arrayContaining([
          expect.objectContaining({ id: "page-3" }),
          expect.objectContaining({ id: "page-1" }),
        ]),
        settings: expect.objectContaining({ jpegQuality: 0.7 }),
      }),
    );
    const cancelled = await service.cancel("job-1");
    expect(cancelled.state).toBe("ready");
    expect(tiles.records).toHaveLength(1);

    resolveExport?.(artifact());
    await vi.waitFor(() => expect(state.current().state).toBe("ready"));
    expect(state.current().outputArtifactId).toBeUndefined();
  });

  it("retries an export failure from the same source tiles without recapture", async () => {
    const state = harness();
    const tiles = storedTileRepository();
    let attempt = 0;
    const exportPdf = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("first export failed"))
        : Promise.resolve(artifact("pdf-2"));
    });
    const service = new PdfExportService({
      jobs: state.jobs,
      tiles,
      offscreen: { exportPdf },
      manifests: manifestRepository(),
      now: () => NOW,
      createId: () => (attempt === 0 ? "pdf-1" : "pdf-2"),
    });

    await service.start("job-1");
    await vi.waitFor(() => expect(state.current().state).toBe("failed"));
    expect(tiles.records).toHaveLength(1);

    await service.start("job-1");
    await vi.waitFor(() => expect(state.current().state).toBe("completed"));
    expect(exportPdf).toHaveBeenCalledTimes(2);
    expect(state.current()).toMatchObject({
      state: "completed",
      outputArtifactId: "pdf-2",
      completedTiles: 1,
      totalTiles: 1,
    });
    expect(tiles.records).toHaveLength(1);
  });
});
