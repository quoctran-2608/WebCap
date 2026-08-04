import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import {
  PdfExportSupervisor,
  type PdfExportRunner,
  type PdfRuntimeMemorySnapshot,
} from "@offscreen/pdf-export-supervisor";
import type { PdfExportPayload, PdfExportResult } from "@offscreen/pdf-exporter";
import type { ArtifactMetadata, ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

function source(width = 100, height = 300): { tile: CaptureTile; record: StoredTileRecord } {
  const tile: CaptureTile = {
    id: "job-1:0",
    jobId: "job-1",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 0, y: 0, width, height },
    outputRectCss: { x: 0, y: 0, width, height },
    expectedPixelWidth: width,
    expectedPixelHeight: height,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    overlapRightCss: 0,
    overlapBottomCss: 0,
    status: "stored",
    attempts: 1,
    byteLength: 3,
    mimeType: "image/png",
  };
  return {
    tile,
    record: {
      schemaVersion: 1,
      jobId: tile.jobId,
      index: tile.index,
      tile,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      createdAt: "2026-08-04T01:00:00.000Z",
      updatedAt: "2026-08-04T01:00:00.000Z",
    },
  };
}

function payload(tile: CaptureTile): PdfExportPayload {
  return {
    jobId: "job-1",
    outputArtifactId: "pdf-1",
    targetRect: tile.sourceRectCss,
    tiles: [tile],
    settings: {
      pageSize: "a4",
      orientation: "portrait",
      marginMm: 8,
      jpegQuality: 0.82,
    },
    pages: [
      {
        id: "page-1",
        originalIndex: 0,
        sourceRectCss: { x: 0, y: 0, width: tile.sourceRectCss.width, height: 150 },
        pageWidthPt: 595.28,
        pageHeightPt: 841.89,
        imageRectPt: { x: 20, y: 20, width: 555.28, height: 801.89 },
      },
      {
        id: "page-2",
        originalIndex: 1,
        sourceRectCss: { x: 0, y: 150, width: tile.sourceRectCss.width, height: 150 },
        pageWidthPt: 595.28,
        pageHeightPt: 841.89,
        imageRectPt: { x: 20, y: 20, width: 555.28, height: 801.89 },
      },
    ],
    filename: "capture.pdf",
    createdAt: "2026-08-04T01:01:00.000Z",
    expiresAt: "2026-08-04T01:31:00.000Z",
  };
}

function repositories(record: StoredTileRecord): {
  tiles: TileRepositoryPort;
  artifacts: ArtifactRepositoryPort;
  artifact: () => ArtifactRecord | undefined;
} {
  let stored: ArtifactRecord | undefined;
  return {
    tiles: {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(record),
      listByJob: () => Promise.resolve([record]),
      deleteByJob: () => Promise.resolve(0),
    },
    artifacts: {
      put: (next) => {
        stored = next;
        return Promise.resolve();
      },
      get: () => Promise.resolve(stored),
      delete: (artifactId) => {
        if (stored?.artifactId !== artifactId) return Promise.resolve(false);
        stored = undefined;
        return Promise.resolve(true);
      },
      deleteExpired: () => Promise.resolve(0),
    },
    artifact: () => stored,
  };
}

function metadata(record: ArtifactRecord): ArtifactMetadata {
  return {
    artifactId: record.artifactId,
    sourceArtifactId: record.sourceArtifactId,
    format: record.format,
    mimeType: record.mimeType,
    filename: record.filename,
    byteLength: record.byteLength,
    width: record.width,
    height: record.height,
    pageCount: record.pageCount,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

function runner(
  artifacts: ArtifactRepositoryPort,
  createBytes: (payload: PdfExportPayload) => Promise<Uint8Array>,
): PdfExportRunner {
  return {
    async export(nextPayload, progress): Promise<PdfExportResult> {
      for (const [index] of (nextPayload.pages ?? []).entries()) {
        if ((await progress?.({
          jobId: nextPayload.jobId,
          completedPages: index + 1,
          totalPages: nextPayload.pages?.length ?? 0,
        })) === false) {
          throw new Error("cancelled");
        }
      }
      const bytes = await createBytes(nextPayload);
      const blob = new Blob([Uint8Array.from(bytes).buffer], { type: "application/pdf" });
      const record: ArtifactRecord = {
        artifactId: nextPayload.outputArtifactId,
        sourceArtifactId: nextPayload.jobId,
        jobId: nextPayload.jobId,
        role: "output",
        format: "pdf",
        mimeType: "application/pdf",
        filename: nextPayload.filename,
        byteLength: blob.size,
        width: 595,
        height: 842,
        pageCount: nextPayload.pages?.length ?? 0,
        createdAt: nextPayload.createdAt,
        expiresAt: nextPayload.expiresAt,
        blob,
      };
      await artifacts.put(record);
      return {
        artifact: metadata(record),
        diagnostics: {
          pageCount: record.pageCount ?? 0,
          decodedTileCount: 2,
          maxDecodedTiles: 1,
          maxCanvasPixelArea: 15_000,
          releasedCanvasCount: 2,
        },
      };
    },
  };
}

async function validPdf(nextPayload: PdfExportPayload): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const pagePlan of nextPayload.pages ?? []) {
    const image = await document.embedJpg(ONE_PIXEL_JPEG);
    const page = document.addPage([pagePlan.pageWidthPt, pagePlan.pageHeightPt]);
    page.drawImage(image, {
      x: pagePlan.imageRectPt.x,
      y: pagePlan.imageRectPt.y,
      width: pagePlan.imageRectPt.width,
      height: pagePlan.imageRectPt.height,
    });
  }
  return document.save();
}

describe("PdfExportSupervisor", () => {
  it("records bounded diagnostics and validates the completed artifact", async () => {
    const input = source();
    const repository = repositories(input.record);
    const samples: Array<PdfRuntimeMemorySnapshot | undefined> = [
      { usedJSHeapSize: 10, jsHeapSizeLimit: 512 * 1_024 * 1_024 },
      { usedJSHeapSize: 20, jsHeapSizeLimit: 512 * 1_024 * 1_024 },
      { usedJSHeapSize: 35, jsHeapSizeLimit: 512 * 1_024 * 1_024 },
      { usedJSHeapSize: 25, jsHeapSizeLimit: 512 * 1_024 * 1_024 },
      { usedJSHeapSize: 15, jsHeapSizeLimit: 512 * 1_024 * 1_024 },
    ];
    const times = [100, 145];
    const supervisor = new PdfExportSupervisor({
      exporter: runner(repository.artifacts, validPdf),
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment: {
        now: () => times.shift() ?? 145,
        memory: () => samples.shift(),
      },
    });

    const result = await supervisor.export(payload(input.tile));

    expect(result.diagnostics).toMatchObject({
      durationMs: 45,
      artifactBytes: expect.any(Number),
      tileBytes: 3,
      maxDecodedTiles: 1,
      releasedCanvasCount: 2,
      heapBeforeBytes: 10,
      heapAfterBytes: 15,
      heapPeakBytes: 35,
      integrityImageObjectCount: 2,
    });
    expect(result.diagnostics.artifactBytes).toBeGreaterThan(0);
    expect(result.diagnostics.estimatedPeakWorkingSetBytes).toBeLessThan(
      result.diagnostics.memoryThresholdBytes,
    );
  });

  it("blocks an unsafe export before the wrapped exporter or artifact write", async () => {
    const input = source(20_000, 8_192);
    const repository = repositories(input.record);
    const exportCall = vi.fn(() => Promise.reject(new Error("must not export")));
    const supervisor = new PdfExportSupervisor({
      exporter: { export: exportCall },
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment: {
        now: () => 0,
        memory: () => ({
          usedJSHeapSize: 10,
          jsHeapSizeLimit: 512 * 1_024 * 1_024,
        }),
      },
    });

    await expect(supervisor.export(payload(input.tile))).rejects.toMatchObject({
      name: "E_MEMORY_GUARD",
      fallbackAllowed: true,
    });
    expect(exportCall).not.toHaveBeenCalled();
    expect(repository.artifact()).toBeUndefined();
    expect((await repository.tiles.listByJob("job-1"))[0]?.blob).toBe(input.record.blob);
  });

  it("deletes a corrupt output artifact but preserves source tiles for retry", async () => {
    const input = source();
    const repository = repositories(input.record);
    const blankPdf = async (nextPayload: PdfExportPayload) => {
      const document = await PDFDocument.create();
      for (const page of nextPayload.pages ?? []) {
        document.addPage([page.pageWidthPt, page.pageHeightPt]);
      }
      return document.save();
    };
    const supervisor = new PdfExportSupervisor({
      exporter: runner(repository.artifacts, blankPdf),
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment: {
        now: () => 0,
        memory: () => undefined,
      },
    });

    await expect(supervisor.export(payload(input.tile))).rejects.toMatchObject({
      name: "E_EXPORT_FAILED",
      data: { causeCode: "PdfIntegrityCheckFailed" },
    });
    expect(repository.artifact()).toBeUndefined();
    expect((await repository.tiles.listByJob("job-1"))[0]?.blob).toBe(input.record.blob);
  });
});
