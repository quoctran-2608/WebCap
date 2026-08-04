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
      get: () => Promise.resolve(undefined),
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

describe("PdfExporter", () => {
  it("creates a loadable multi-page PDF while holding one decoded tile and one page canvas", async () => {
    const source = storedTile();
    const repository = repositories([source.record]);
    const canvasSizes: Array<{ width: number; height: number }> = [];
    let drawCount = 0;
    let closeCount = 0;
    let releaseCount = 0;
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
    expect(stored?.blob.size ?? 0).toBeGreaterThan(0);
    const loaded = await PDFDocument.load(
      new Uint8Array(await (stored as ArtifactRecord).blob.arrayBuffer()),
    );
    expect(loaded.getPageCount()).toBe(3);
    expect(result.diagnostics).toMatchObject({
      pageCount: 3,
      decodedTileCount: 3,
      maxDecodedTiles: 1,
      releasedCanvasCount: 3,
    });
    expect(result.diagnostics.maxCanvasPixelArea).toBeLessThan(100 * 300);
    expect(canvasSizes).toHaveLength(3);
    expect(canvasSizes.every((canvas) => canvas.width === 100)).toBe(true);
    expect(drawCount).toBe(3);
    expect(closeCount).toBe(3);
    expect(releaseCount).toBe(3);
    expect(progress).toEqual([1, 2, 3]);
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
});
