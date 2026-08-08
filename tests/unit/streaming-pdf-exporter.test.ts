import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import { StreamingPdfExporter } from "@offscreen/streaming-pdf-exporter";
import type { PdfExportResult, PdfPageCanvasPort } from "@offscreen/pdf-exporter";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { PdfOutputSpoolPort, PdfSpoolFile, PdfSpoolWritable } from "@storage/pdf-output-spool";
import type {
  PdfWriterCheckpoint,
  PdfWriterCheckpointRepositoryPort,
} from "@storage/pdf-writer-checkpoint-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

class MemorySpool implements PdfOutputSpoolPort {
  readonly files = new Map<string, Blob>();

  availableBytes(): Promise<number | undefined> {
    return Promise.resolve(1_000_000_000);
  }

  createOutput(outputArtifactId: string): Promise<PdfSpoolWritable> {
    const reference = `webcap-pdf-output/${outputArtifactId}.pdf`;
    const chunks: ArrayBuffer[] = [];
    let byteLength = 0;
    let closed = false;
    const files = this.files;
    return Promise.resolve({
      reference,
      get byteLength() {
        return byteLength;
      },
      write(chunk) {
        if (closed) return Promise.reject(new Error("closed"));
        const copy = Uint8Array.from(chunk).buffer;
        chunks.push(copy);
        byteLength += copy.byteLength;
        return Promise.resolve();
      },
      close() {
        closed = true;
        const blob = new Blob(chunks, { type: "application/pdf" });
        files.set(reference, blob);
        return Promise.resolve({
          reference,
          byteLength: blob.size,
          mimeType: "application/pdf",
          blob,
        });
      },
      abort() {
        closed = true;
        files.delete(reference);
        return Promise.resolve();
      },
    });
  }

  writeRasterPage(outputArtifactId: string, pageIndex: number, blob: Blob): Promise<PdfSpoolFile> {
    const reference = `webcap-pdf-output/${outputArtifactId}.page-${pageIndex}.jpg`;
    const owned = blob.slice(0, blob.size, "image/jpeg");
    this.files.set(reference, owned);
    return Promise.resolve({
      reference,
      byteLength: owned.size,
      mimeType: "image/jpeg",
      blob: owned,
    });
  }

  read(reference: string): Promise<Blob> {
    const blob = this.files.get(reference);
    if (blob === undefined) return Promise.reject(new Error("missing"));
    return Promise.resolve(blob);
  }

  delete(reference: string): Promise<void> {
    this.files.delete(reference);
    return Promise.resolve();
  }
}

function checkpointRepository(): {
  repository: PdfWriterCheckpointRepositoryPort;
  current: () => PdfWriterCheckpoint | undefined;
} {
  let checkpoint: PdfWriterCheckpoint | undefined;
  return {
    repository: {
      get: () => Promise.resolve(checkpoint),
      put: (next) => {
        checkpoint = next;
        return Promise.resolve();
      },
      delete: () => {
        const existed = checkpoint !== undefined;
        checkpoint = undefined;
        return Promise.resolve(existed);
      },
    },
    current: () => checkpoint,
  };
}

function sourceTile(): { tile: CaptureTile; record: StoredTileRecord } {
  const tile: CaptureTile = {
    id: "job-stream:0",
    jobId: "job-stream",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 0, y: 0, width: 1, height: 3 },
    outputRectCss: { x: 0, y: 0, width: 1, height: 3 },
    captureViewportCss: { x: 0, y: 0, width: 1, height: 3 },
    expectedPixelWidth: 1,
    expectedPixelHeight: 3,
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
      createdAt: "2026-08-08T03:00:00.000Z",
      updatedAt: "2026-08-08T03:00:00.000Z",
    },
  };
}

function repositories(record: StoredTileRecord): {
  tiles: TileRepositoryPort;
  artifacts: ArtifactRepositoryPort;
  artifact: () => ArtifactRecord | undefined;
} {
  let artifact: ArtifactRecord | undefined;
  return {
    tiles: {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(record),
      listByJob: () => Promise.resolve([record]),
      deleteByJob: () => Promise.resolve(0),
    },
    artifacts: {
      put: (next) => {
        artifact = next;
        return Promise.resolve();
      },
      get: () => Promise.resolve(artifact),
      delete: () => Promise.resolve(false),
      deleteExpired: () => Promise.resolve(0),
    },
    artifact: () => artifact,
  };
}

function pages() {
  return [0, 1, 2].map((index) => ({
    id: `page-${index + 1}`,
    originalIndex: index,
    sourceRectCss: { x: 0, y: index, width: 1, height: 1 },
    pageWidthPt: index === 1 ? 842 : 595,
    pageHeightPt: index === 1 ? 595 : 842,
    imageRectPt: {
      x: 0,
      y: 0,
      width: index === 1 ? 842 : 595,
      height: index === 1 ? 595 : 842,
    },
  }));
}

function fallbackResult(): PdfExportResult {
  return {
    artifact: {
      artifactId: "legacy",
      sourceArtifactId: "job-stream",
      format: "pdf",
      mimeType: "application/pdf",
      filename: "legacy.pdf",
      byteLength: 10,
      width: 1,
      height: 1,
      pageCount: 1,
      createdAt: "2026-08-08T03:00:00.000Z",
      expiresAt: "2026-08-08T03:30:00.000Z",
    },
    diagnostics: {
      pageCount: 1,
      decodedTileCount: 0,
      maxDecodedTiles: 0,
      maxCanvasPixelArea: 0,
      releasedCanvasCount: 0,
      durationMs: 0,
      artifactBytes: 10,
      memoryEstimate: {
        totalPixels: 1,
        estimatedPageRgbaBytes: 4,
        estimatedDecodedTileBytes: 4,
        estimatedEncodedPageBytes: 1,
        estimatedWorkingSetBytes: 10,
        thresholdBytes: 100,
        shouldBlock: false,
        reasons: [],
        alternatives: ["lower-quality", "split-output", "multi-page-pdf"],
      },
      integrity: { valid: true, pageCount: 1, imageObjectCount: 1, nonEmptyStreamCount: 1 },
    },
  };
}

describe("StreamingPdfExporter", () => {
  it("spools page JPEGs, checkpoints each page, and stores only a disk reference for final PDF", async () => {
    const source = sourceTile();
    const repo = repositories(source.record);
    const spool = new MemorySpool();
    const checkpoints = checkpointRepository();
    const progress: number[] = [];
    let closeCount = 0;
    let releaseCount = 0;
    const exporter = new StreamingPdfExporter({
      tiles: repo.tiles,
      artifacts: repo.artifacts,
      spool,
      checkpoints: checkpoints.repository,
      fallback: { export: () => Promise.reject(new Error("fallback must not run")) },
      environment: {
        decode: () =>
          Promise.resolve({
            width: 1,
            height: 3,
            source: {} as CanvasImageSource,
            close() {
              closeCount += 1;
            },
          }),
        createCanvas(width, height): PdfPageCanvasPort {
          return {
            width,
            height,
            getContext: () => ({ fillWhite: () => undefined, drawImage: () => undefined }),
            convertToJpeg: () =>
              Promise.resolve(
                new Blob([Uint8Array.from(ONE_PIXEL_JPEG).buffer], { type: "image/jpeg" }),
              ),
            release() {
              releaseCount += 1;
            },
          };
        },
      },
    });

    const result = await exporter.export(
      {
        jobId: "job-stream",
        outputArtifactId: "streamed-pdf",
        targetRect: { x: 0, y: 0, width: 1, height: 3 },
        tiles: [source.tile],
        pages: pages(),
        settings: DEFAULT_CAPTURE_SETTINGS.pdf,
        filename: "streamed.pdf",
        createdAt: "2026-08-08T03:00:00.000Z",
        expiresAt: "2026-08-08T03:30:00.000Z",
      },
      ({ completedPages }) => {
        progress.push(completedPages);
        return Promise.resolve(true);
      },
    );

    expect(progress).toEqual([1, 2, 3]);
    expect(checkpoints.current()).toMatchObject({
      jobId: "job-stream",
      outputArtifactId: "streamed-pdf",
      pagesWritten: 3,
      totalPages: 3,
      spoolReference: "webcap-pdf-output/streamed-pdf.pdf",
    });
    expect(repo.artifact()).toMatchObject({
      artifactId: "streamed-pdf",
      role: "output",
      format: "pdf",
      pageCount: 3,
      opfsReference: "webcap-pdf-output/streamed-pdf.pdf",
    });
    expect(repo.artifact()?.blob).toBeUndefined();
    expect(result.diagnostics).toMatchObject({
      pageCount: 3,
      maxDecodedTiles: 1,
      releasedCanvasCount: 3,
      integrity: { valid: true, pageCount: 3 },
    });
    expect(closeCount).toBe(3);
    expect(releaseCount).toBe(3);
    expect([...spool.files.keys()].filter((key) => key.endsWith(".jpg"))).toHaveLength(0);

    const finalBlob = await spool.read("webcap-pdf-output/streamed-pdf.pdf");
    const loaded = await PDFDocument.load(new Uint8Array(await finalBlob.arrayBuffer()));
    expect(loaded.getPageCount()).toBe(3);
  });

  it("does not treat document-wide tile count as active streaming memory", async () => {
    const tileCount = 4_097;
    const tiles: CaptureTile[] = [];
    const records: StoredTileRecord[] = [];
    for (let index = 0; index < tileCount; index += 1) {
      const tile: CaptureTile = {
        id: `job-stream:${index}`,
        jobId: "job-stream",
        index,
        row: index,
        column: 0,
        sourceRectCss: { x: 0, y: index, width: 1, height: 1 },
        outputRectCss: { x: 0, y: index, width: 1, height: 1 },
        captureViewportCss: { x: 0, y: index, width: 1, height: 1 },
        expectedPixelWidth: 1,
        expectedPixelHeight: 1,
        overlapTopCss: 0,
        overlapLeftCss: 0,
        overlapRightCss: 0,
        overlapBottomCss: 0,
        status: "stored",
        attempts: 1,
        byteLength: 1,
        mimeType: "image/png",
      };
      tiles.push(tile);
      records.push({
        schemaVersion: 1,
        jobId: tile.jobId,
        index,
        tile,
        blob: new Blob([new Uint8Array([index & 0xff])], { type: "image/png" }),
        createdAt: "2026-08-08T03:00:00.000Z",
        updatedAt: "2026-08-08T03:00:00.000Z",
      });
    }
    let artifact: ArtifactRecord | undefined;
    const spool = new MemorySpool();
    const checkpoints = checkpointRepository();
    const exporter = new StreamingPdfExporter({
      tiles: {
        put: () => Promise.resolve(),
        get: (_jobId, index) => Promise.resolve(records[index]),
        listByJob: () => Promise.resolve(records),
        deleteByJob: () => Promise.resolve(0),
      },
      artifacts: {
        put: (next) => {
          artifact = next;
          return Promise.resolve();
        },
        get: () => Promise.resolve(artifact),
        delete: () => Promise.resolve(false),
        deleteExpired: () => Promise.resolve(0),
      },
      spool,
      checkpoints: checkpoints.repository,
      fallback: { export: () => Promise.reject(new Error("fallback must not run")) },
      environment: {
        decode: () =>
          Promise.resolve({
            width: 1,
            height: 1,
            source: {} as CanvasImageSource,
            close: () => undefined,
          }),
        createCanvas(width, height): PdfPageCanvasPort {
          return {
            width,
            height,
            getContext: () => ({ fillWhite: () => undefined, drawImage: () => undefined }),
            convertToJpeg: () =>
              Promise.resolve(
                new Blob([Uint8Array.from(ONE_PIXEL_JPEG).buffer], { type: "image/jpeg" }),
              ),
            release: () => undefined,
          };
        },
      },
    });

    const result = await exporter.export({
      jobId: "job-stream",
      outputArtifactId: "long-document-selected-page",
      targetRect: { x: 0, y: 0, width: 1, height: tileCount },
      tiles,
      pages: [
        {
          id: "selected-page-1",
          originalIndex: 0,
          sourceRectCss: { x: 0, y: 0, width: 1, height: 1 },
          pageWidthPt: 595,
          pageHeightPt: 842,
          imageRectPt: { x: 0, y: 0, width: 595, height: 842 },
        },
      ],
      settings: DEFAULT_CAPTURE_SETTINGS.pdf,
      filename: "selected-page.pdf",
      createdAt: "2026-08-08T03:00:00.000Z",
      expiresAt: "2026-08-08T03:30:00.000Z",
    });

    expect(result.diagnostics.pageCount).toBe(1);
    expect(result.diagnostics.memoryEstimate.reasons).not.toContain("tile-count");
    expect(result.diagnostics.memoryEstimate.reasons).not.toContain("tile-bytes");
    expect(result.diagnostics.memoryEstimate.shouldBlock).toBe(false);
    expect(artifact?.opfsReference).toBe("webcap-pdf-output/long-document-selected-page.pdf");
  });

  it("falls back to the legacy exporter only when OPFS is unavailable before writing", async () => {
    const source = sourceTile();
    const repo = repositories(source.record);
    const checkpoints = checkpointRepository();
    const fallback = vi.fn(() => Promise.resolve(fallbackResult()));
    const unavailableSpool: PdfOutputSpoolPort = {
      availableBytes: () => Promise.resolve(undefined),
      createOutput: () => {
        const error = new Error("OPFS unavailable") as Error & {
          data: { fallbackAllowed: boolean };
        };
        error.data = { fallbackAllowed: true };
        return Promise.reject(error);
      },
      writeRasterPage: () => Promise.reject(new Error("must not write raster")),
      read: () => Promise.reject(new Error("must not read")),
      delete: () => Promise.resolve(),
    };
    const exporter = new StreamingPdfExporter({
      tiles: repo.tiles,
      artifacts: repo.artifacts,
      spool: unavailableSpool,
      checkpoints: checkpoints.repository,
      fallback: { export: fallback },
    });

    const result = await exporter.export({
      jobId: "job-stream",
      outputArtifactId: "fallback-pdf",
      targetRect: { x: 0, y: 0, width: 1, height: 3 },
      tiles: [source.tile],
      settings: DEFAULT_CAPTURE_SETTINGS.pdf,
      filename: "fallback.pdf",
      createdAt: "2026-08-08T03:00:00.000Z",
      expiresAt: "2026-08-08T03:30:00.000Z",
    });

    expect(result.artifact.artifactId).toBe("legacy");
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
