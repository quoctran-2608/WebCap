import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  PdfExporter,
  type PdfDocumentPort,
  type PdfExportEnvironment,
  type PdfPageCanvasPort,
} from "@offscreen/pdf-exporter";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

function storedTile(): { tile: CaptureTile; record: StoredTileRecord } {
  const tile: CaptureTile = {
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
  return {
    tile,
    record: {
      schemaVersion: 1,
      jobId: tile.jobId,
      index: tile.index,
      tile,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      createdAt: "2026-08-03T11:00:00.000Z",
      updatedAt: "2026-08-03T11:00:00.000Z",
    },
  };
}

function repositories(records: StoredTileRecord[]): {
  tiles: TileRepositoryPort;
  artifacts: ArtifactRepositoryPort;
  stored: () => ArtifactRecord | undefined;
} {
  let output: ArtifactRecord | undefined;
  return {
    tiles: {
      put: () => Promise.resolve(),
      get: (_jobId, index) => Promise.resolve(records.find((record) => record.index === index)),
      listByJob: () => Promise.resolve(records),
      deleteByJob: () => Promise.resolve(0),
    },
    artifacts: {
      put: (record) => {
        output = record;
        return Promise.resolve();
      },
      get: () => Promise.resolve(output),
      delete: () => Promise.resolve(false),
      deleteExpired: () => Promise.resolve(0),
    },
    stored: () => output,
  };
}

async function realPdfDocument(): Promise<PdfDocumentPort> {
  const document = await PDFDocument.create();
  return {
    async addJpegPage(options) {
      const image = await document.embedJpg(options.bytes);
      const page = document.addPage([options.pageWidthPt, options.pageHeightPt]);
      page.drawImage(image, {
        x: options.imageRectPt.x,
        y: options.imageRectPt.y,
        width: options.imageRectPt.width,
        height: options.imageRectPt.height,
      });
    },
    save: () => document.save(),
  };
}

function pageEnvironment(): PdfExportEnvironment {
  return {
    decode: () =>
      Promise.resolve({
        width: 100,
        height: 300,
        source: {} as CanvasImageSource,
        close: () => undefined,
      }),
    createCanvas: (width, height) => ({
      width,
      height,
      getContext: () => ({ fillWhite: () => undefined, drawImage: () => undefined }),
      convertToJpeg: () =>
        Promise.resolve(new Blob([Uint8Array.from(ONE_PIXEL_JPEG)], { type: "image/jpeg" })),
      release: () => undefined,
    }),
    createDocument: realPdfDocument,
  };
}

describe("PdfExporter", () => {
  it("creates a loadable multi-page PDF while holding one decoded tile and one page canvas", async () => {
    const source = storedTile();
    const repository = repositories([source.record]);
    const canvasSizes: Array<{ width: number; height: number }> = [];
    let drawCount = 0;
    let closeCount = 0;
    let releaseCount = 0;
    let clock = 100;
    const environment: PdfExportEnvironment = {
      decode: () =>
        Promise.resolve({
          width: 100,
          height: 300,
          source: {} as CanvasImageSource,
          close() {
            closeCount += 1;
          },
        }),
      createCanvas(width, height): PdfPageCanvasPort {
        canvasSizes.push({ width, height });
        return {
          width,
          height,
          getContext: () => ({
            fillWhite: () => undefined,
            drawImage: () => {
              drawCount += 1;
            },
          }),
          convertToJpeg: () =>
            Promise.resolve(
              new Blob([Uint8Array.from(ONE_PIXEL_JPEG).buffer], { type: "image/jpeg" }),
            ),
          release() {
            releaseCount += 1;
          },
        };
      },
      createDocument: realPdfDocument,
      now: () => {
        clock += 5;
        return clock;
      },
      readHeapSnapshot: () => ({
        usedBytes: 48 * 1_024 * 1_024 + closeCount * 1_024,
        limitBytes: 512 * 1_024 * 1_024,
      }),
    };
    const progress: number[] = [];
    const exporter = new PdfExporter({
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment,
    });

    const result = await exporter.export(
      {
        jobId: "job-1",
        outputArtifactId: "pdf-1",
        targetRect: { x: 0, y: 0, width: 100, height: 300 },
        tiles: [source.tile],
        settings: DEFAULT_CAPTURE_SETTINGS.pdf,
        filename: "capture.pdf",
        createdAt: "2026-08-03T11:01:00.000Z",
        expiresAt: "2026-08-03T11:31:00.000Z",
      },
      ({ completedPages }) => {
        progress.push(completedPages);
        return Promise.resolve(true);
      },
    );

    const stored = repository.stored();
    expect(stored).toMatchObject({
      artifactId: "pdf-1",
      role: "output",
      format: "pdf",
      mimeType: "application/pdf",
      filename: "capture.pdf",
      pageCount: 3,
    });
    if (stored?.blob === undefined) throw new Error("Legacy PDF exporter did not persist a Blob.");
    expect(stored.blob.size).toBeGreaterThan(0);
    const loaded = await PDFDocument.load(new Uint8Array(await stored.blob.arrayBuffer()));
    expect(loaded.getPageCount()).toBe(3);
    expect(result.diagnostics).toMatchObject({
      pageCount: 3,
      decodedTileCount: 3,
      maxDecodedTiles: 1,
      releasedCanvasCount: 3,
      integrity: { valid: true, pageCount: 3 },
      heapLimitBytes: 512 * 1_024 * 1_024,
    });
    expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.artifactBytes).toBe(stored.blob.size);
    expect(result.diagnostics.memoryEstimate.shouldBlock).toBe(false);
    expect(result.diagnostics.peakHeapBytes).toBeGreaterThanOrEqual(48 * 1_024 * 1_024);
    expect(result.diagnostics.maxCanvasPixelArea).toBeLessThan(100 * 300);
    expect(canvasSizes).toHaveLength(3);
    expect(canvasSizes.every((canvas) => canvas.width === 100)).toBe(true);
    expect(drawCount).toBe(3);
    expect(closeCount).toBe(3);
    expect(releaseCount).toBe(3);
    expect(progress).toEqual([1, 2, 3]);
  });

  it("uses the largest logical page rather than total document height for the memory guard", async () => {
    const source = storedTile();
    const repository = repositories([source.record]);
    const exporter = new PdfExporter({
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment: pageEnvironment(),
    });

    const result = await exporter.export({
      jobId: "job-1",
      outputArtifactId: "pdf-streamed-pages",
      targetRect: { x: 0, y: 0, width: 100, height: 20_000_000 },
      tiles: [source.tile],
      pages: [
        {
          id: "document-page-1",
          originalIndex: 0,
          sourceRectCss: { x: 0, y: 0, width: 100, height: 150 },
          pageWidthPt: 100,
          pageHeightPt: 150,
          imageRectPt: { x: 0, y: 0, width: 100, height: 150 },
        },
        {
          id: "document-page-2",
          originalIndex: 1,
          sourceRectCss: { x: 0, y: 150, width: 100, height: 150 },
          pageWidthPt: 100,
          pageHeightPt: 150,
          imageRectPt: { x: 0, y: 0, width: 100, height: 150 },
        },
      ],
      settings: DEFAULT_CAPTURE_SETTINGS.pdf,
      filename: "streamed-pages.pdf",
      createdAt: "2026-08-03T11:01:00.000Z",
      expiresAt: "2026-08-03T11:31:00.000Z",
    });

    expect(result.diagnostics.pageCount).toBe(2);
    expect(result.diagnostics.memoryEstimate.shouldBlock).toBe(false);
    expect(result.diagnostics.memoryEstimate.totalPixels).toBe(15_000);
    expect(repository.stored()?.pageCount).toBe(2);
  });

  it("fails before allocating a page when a stored source tile is missing", async () => {
    const source = storedTile();
    const repository = repositories([]);
    let canvasCreated = false;
    const exporter = new PdfExporter({
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment: {
        decode: () => Promise.reject(new Error("must not decode")),
        createCanvas: () => {
          canvasCreated = true;
          throw new Error("must not create canvas");
        },
        createDocument: realPdfDocument,
      },
    });

    await expect(
      exporter.export({
        jobId: "job-1",
        outputArtifactId: "pdf-1",
        targetRect: { x: 0, y: 0, width: 100, height: 300 },
        tiles: [source.tile],
        settings: DEFAULT_CAPTURE_SETTINGS.pdf,
        filename: "capture.pdf",
        createdAt: "2026-08-03T11:01:00.000Z",
        expiresAt: "2026-08-03T11:31:00.000Z",
      }),
    ).rejects.toMatchObject({ name: "E_STORAGE_READ" });
    expect(canvasCreated).toBe(false);
    expect(repository.stored()).toBeUndefined();
  });

  it("blocks an unsafe estimate before creating a PDF document or canvas", async () => {
    const source = storedTile();
    const repository = repositories([source.record]);
    let documentCreated = false;
    let canvasCreated = false;
    const exporter = new PdfExporter({
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment: {
        ...pageEnvironment(),
        createDocument: () => {
          documentCreated = true;
          return realPdfDocument();
        },
        createCanvas: () => {
          canvasCreated = true;
          throw new Error("must not create canvas");
        },
        readHeapSnapshot: () => ({ limitBytes: 40 * 1_024 * 1_024 }),
      },
    });

    await expect(
      exporter.export({
        jobId: "job-1",
        outputArtifactId: "pdf-memory-blocked",
        targetRect: { x: 0, y: 0, width: 100, height: 300 },
        tiles: [source.tile],
        settings: DEFAULT_CAPTURE_SETTINGS.pdf,
        filename: "blocked.pdf",
        createdAt: "2026-08-03T11:01:00.000Z",
        expiresAt: "2026-08-03T11:31:00.000Z",
      }),
    ).rejects.toMatchObject({
      name: "E_MEMORY_GUARD",
      retryable: true,
      fallbackAllowed: true,
    });
    expect(documentCreated).toBe(false);
    expect(canvasCreated).toBe(false);
    expect(repository.stored()).toBeUndefined();
    expect(await repository.tiles.get("job-1", 0)).toBeDefined();
  });

  it("rejects a corrupt integrity report before artifact persistence and retains source tiles", async () => {
    const source = storedTile();
    const repository = repositories([source.record]);
    const exporter = new PdfExporter({
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment: pageEnvironment(),
      inspectIntegrity: () =>
        Promise.resolve({
          valid: false,
          byteLength: 5,
          signatureValid: true,
          pageCount: 0,
          pages: [],
          imageObjectCount: 0,
          nonEmptyStreamCount: 0,
          errors: ["page-count-mismatch"],
        }),
    });

    await expect(
      exporter.export({
        jobId: "job-1",
        outputArtifactId: "pdf-invalid",
        targetRect: { x: 0, y: 0, width: 100, height: 300 },
        tiles: [source.tile],
        settings: DEFAULT_CAPTURE_SETTINGS.pdf,
        filename: "invalid.pdf",
        createdAt: "2026-08-03T11:01:00.000Z",
        expiresAt: "2026-08-03T11:31:00.000Z",
      }),
    ).rejects.toMatchObject({
      name: "E_EXPORT_FAILED",
      data: { causeCode: "PdfIntegrityCheckFailed" },
    });
    expect(repository.stored()).toBeUndefined();
    expect(await repository.tiles.get("job-1", 0)).toBeDefined();
  });
});
