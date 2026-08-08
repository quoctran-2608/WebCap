import type { ArtifactMetadata, ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile, Rect } from "@shared/contracts/domain";
import type { PdfEditorPage } from "@shared/contracts/pdf-editor";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import { isPdfSpoolFallbackAllowed, type PdfOutputSpoolPort } from "@storage/pdf-output-spool";
import type {
  PdfWriterCheckpointRepositoryPort,
  PdfWriterCheckpoint,
} from "@storage/pdf-writer-checkpoint-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

import { planPdfDocument } from "./pdf-layout";
import { assertPdfExportMemorySafe, type PdfMemoryEstimate } from "./pdf-memory-guard";
import { planPdfTileIntersections } from "./pdf-tile-intersections";
import type {
  DecodedPdfTile,
  PdfExportPayload,
  PdfExportProgress,
  PdfExportResult,
  PdfHeapSnapshot,
  PdfPageCanvasPort,
  PdfExporter,
} from "./pdf-exporter";
import { assertStreamingPdfStructure } from "./streaming-pdf-integrity";
import { SequentialRasterPdfWriter } from "./streaming-pdf-writer";

export interface StreamingPdfExportEnvironment {
  decode(blob: Blob): Promise<DecodedPdfTile>;
  createCanvas(width: number, height: number): PdfPageCanvasPort;
  now?: (() => number) | undefined;
  readHeapSnapshot?: (() => PdfHeapSnapshot) | undefined;
}

export interface StreamingPdfExporterOptions {
  tiles: TileRepositoryPort;
  artifacts: ArtifactRepositoryPort;
  spool: PdfOutputSpoolPort;
  checkpoints: PdfWriterCheckpointRepositoryPort;
  fallback: Pick<PdfExporter, "export">;
  environment?: StreamingPdfExportEnvironment;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

const defaultEnvironment: StreamingPdfExportEnvironment = {
  async decode(blob) {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  },
  createCanvas(width, height) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    return {
      width,
      height,
      getContext: () =>
        context === null
          ? null
          : {
              fillWhite(canvasWidth, canvasHeight) {
                context.save();
                context.fillStyle = "#ffffff";
                context.fillRect(0, 0, canvasWidth, canvasHeight);
                context.restore();
              },
              drawImage(
                image,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                destinationX,
                destinationY,
                destinationWidth,
                destinationHeight,
              ) {
                context.drawImage(
                  image.source,
                  sourceX,
                  sourceY,
                  sourceWidth,
                  sourceHeight,
                  destinationX,
                  destinationY,
                  destinationWidth,
                  destinationHeight,
                );
              },
            },
      convertToJpeg: (quality) => canvas.convertToBlob({ type: "image/jpeg", quality }),
      release() {
        canvas.width = 1;
        canvas.height = 1;
      },
    };
  },
  now: () => performance.now(),
  readHeapSnapshot() {
    const memory = (performance as PerformanceWithMemory).memory;
    return memory === undefined
      ? {}
      : {
          usedBytes: memory.usedJSHeapSize,
          limitBytes: memory.jsHeapSizeLimit,
        };
  },
};

function exportError(message: string, causeCode: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message,
      userMessageKey: "errors.exportFailed",
      retryable: true,
      fallbackAllowed: false,
      causeCode,
    }),
  );
}

function storageReadError(message: string, safeContext: Record<string, string | number>): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message,
      userMessageKey: "errors.storageRead",
      retryable: true,
      fallbackAllowed: false,
      safeContext,
    }),
  );
}

function cancelledError(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_CANCELLED",
      stage: "export",
      message: "PDF export was cancelled before the streamed output artifact was saved.",
      userMessageKey: "errors.cancelled",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "StreamingPdfExportCancelled",
      safeContext: { jobId: jobId.slice(0, 24) },
    }),
  );
}

function positiveScale(value: number, axis: "x" | "y"): number {
  if (!Number.isFinite(value) || value <= 0 || value > 8) {
    throw exportError(
      `The streamed PDF ${axis}-axis tile scale is invalid.`,
      "StreamingPdfTileScaleInvalid",
    );
  }
  return value;
}

function roundRange(
  start: number,
  end: number,
  maximum: number,
): { start: number; length: number } {
  const roundedStart = Math.max(0, Math.min(maximum, Math.round(start)));
  const roundedEnd = Math.max(roundedStart, Math.min(maximum, Math.round(end)));
  return { start: roundedStart, length: roundedEnd - roundedStart };
}

function defaultEditorPages(payload: PdfExportPayload): PdfEditorPage[] {
  return planPdfDocument(payload.targetRect, payload.settings).pages.map((page) => ({
    id: `page-${page.index + 1}`,
    originalIndex: page.index,
    sourceRectCss: page.sourceRectCss,
    pageWidthPt: page.pageWidthPt,
    pageHeightPt: page.pageHeightPt,
    imageRectPt: page.imageRectPt,
  }));
}

function validHeapValue(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nowMilliseconds(environment: StreamingPdfExportEnvironment): number {
  const value = environment.now?.() ?? Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

function readHeapSnapshot(environment: StreamingPdfExportEnvironment): PdfHeapSnapshot {
  try {
    const snapshot = environment.readHeapSnapshot?.() ?? {};
    const usedBytes = validHeapValue(snapshot.usedBytes);
    const limitBytes = validHeapValue(snapshot.limitBytes);
    return {
      ...(usedBytes === undefined ? {} : { usedBytes }),
      ...(limitBytes === undefined ? {} : { limitBytes }),
    };
  } catch {
    return {};
  }
}

function artifactMetadata(record: ArtifactRecord): ArtifactMetadata {
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

export class StreamingPdfExporter {
  private readonly tiles: TileRepositoryPort;
  private readonly artifacts: ArtifactRepositoryPort;
  private readonly spool: PdfOutputSpoolPort;
  private readonly checkpoints: PdfWriterCheckpointRepositoryPort;
  private readonly fallback: Pick<PdfExporter, "export">;
  private readonly environment: StreamingPdfExportEnvironment;

  constructor(options: StreamingPdfExporterOptions) {
    this.tiles = options.tiles;
    this.artifacts = options.artifacts;
    this.spool = options.spool;
    this.checkpoints = options.checkpoints;
    this.fallback = options.fallback;
    this.environment = options.environment ?? defaultEnvironment;
  }

  async export(
    payload: PdfExportPayload,
    reportProgress: (progress: PdfExportProgress) => Promise<boolean> = () => Promise.resolve(true),
  ): Promise<PdfExportResult> {
    const startedAt = nowMilliseconds(this.environment);
    await this.checkpoints.delete(payload.jobId).catch(() => false);

    let output;
    try {
      output = await this.spool.createOutput(payload.outputArtifactId);
    } catch (error) {
      if (isPdfSpoolFallbackAllowed(error)) {
        return this.fallback.export(payload, reportProgress);
      }
      throw error;
    }

    const writerPages = payload.pages ?? defaultEditorPages(payload);
    if (writerPages.length === 0) {
      await output.abort().catch(() => undefined);
      throw exportError(
        "PDF export requires at least one selected page.",
        "StreamingPdfPagesMissing",
      );
    }
    const writer = new SequentialRasterPdfWriter(output, writerPages.length);
    const rasterReferences = new Set<string>();

    try {
      const records = await this.tiles.listByJob(payload.jobId);
      const recordByIndex = new Map(records.map((record) => [record.index, record]));
      let tileBytes = 0;
      for (const tile of payload.tiles) {
        const record = recordByIndex.get(tile.index);
        if (record?.blob === undefined || record.tile.status !== "stored") {
          throw storageReadError("A stored capture tile is unavailable for streamed PDF export.", {
            jobId: payload.jobId.slice(0, 24),
            tileIndex: tile.index,
          });
        }
        tileBytes += record.blob.size;
      }

      const firstTile = payload.tiles[0];
      if (firstTile === undefined) {
        throw exportError(
          "PDF export requires at least one stored capture tile.",
          "StreamingPdfTilesMissing",
        );
      }
      const renderScaleX = positiveScale(
        firstTile.expectedPixelWidth / firstTile.sourceRectCss.width,
        "x",
      );
      const renderScaleY = positiveScale(
        firstTile.expectedPixelHeight / firstTile.sourceRectCss.height,
        "y",
      );
      const totalPixelWidth = Math.max(1, Math.round(payload.targetRect.width * renderScaleX));
      const totalPixelHeight = Math.max(1, Math.round(payload.targetRect.height * renderScaleY));
      const pagePixelRanges = writerPages.map((page) => {
        const pixelXRange = roundRange(
          (page.sourceRectCss.x - payload.targetRect.x) * renderScaleX,
          (page.sourceRectCss.x + page.sourceRectCss.width - payload.targetRect.x) * renderScaleX,
          totalPixelWidth,
        );
        const pixelYRange = roundRange(
          (page.sourceRectCss.y - payload.targetRect.y) * renderScaleY,
          (page.sourceRectCss.y + page.sourceRectCss.height - payload.targetRect.y) * renderScaleY,
          totalPixelHeight,
        );
        if (pixelXRange.length <= 0 || pixelYRange.length <= 0) {
          throw exportError(
            "A streamed PDF page pixel range is empty.",
            "StreamingPdfPagePixelRangeMissing",
          );
        }
        return { page, pixelXRange, pixelYRange };
      });

      const maxPagePixelArea = Math.max(
        ...pagePixelRanges.map(
          ({ pixelXRange, pixelYRange }) => pixelXRange.length * pixelYRange.length,
        ),
      );
      const largestTilePixelArea = Math.max(
        ...payload.tiles.map((tile) => tile.expectedPixelWidth * tile.expectedPixelHeight),
      );
      const initialHeap = readHeapSnapshot(this.environment);
      const memoryEstimate: PdfMemoryEstimate = assertPdfExportMemorySafe({
        widthCss: Math.max(...writerPages.map((page) => page.sourceRectCss.width)),
        heightCss: Math.max(...writerPages.map((page) => page.sourceRectCss.height)),
        renderScaleX,
        renderScaleY,
        tileCount: payload.tiles.length,
        tileBytes,
        pageCount: writerPages.length,
        maxPagePixelArea,
        largestTilePixelArea,
        jpegQuality: payload.settings.jpegQuality,
        ...(initialHeap.limitBytes === undefined ? {} : { heapLimitBytes: initialHeap.limitBytes }),
      });

      let activeDecodedTiles = 0;
      let decodedTileCount = 0;
      let maxDecodedTiles = 0;
      let maxCanvasPixelArea = 0;
      let releasedCanvasCount = 0;
      let peakHeapBytes = initialHeap.usedBytes;
      let heapLimitBytes = initialHeap.limitBytes;
      const sampleHeap = () => {
        const snapshot = readHeapSnapshot(this.environment);
        if (snapshot.usedBytes !== undefined) {
          peakHeapBytes = Math.max(peakHeapBytes ?? 0, snapshot.usedBytes);
        }
        if (snapshot.limitBytes !== undefined) heapLimitBytes = snapshot.limitBytes;
      };

      for (const [outputIndex, entry] of pagePixelRanges.entries()) {
        const { page, pixelXRange, pixelYRange } = entry;
        const canvasWidth = pixelXRange.length;
        const canvasHeight = pixelYRange.length;
        const canvas = this.environment.createCanvas(canvasWidth, canvasHeight);
        maxCanvasPixelArea = Math.max(maxCanvasPixelArea, canvas.width * canvas.height);
        sampleHeap();
        let rasterReference: string | undefined;
        try {
          const context = canvas.getContext();
          if (context === null) {
            throw exportError(
              "WebCap could not create a streamed PDF page canvas context.",
              "StreamingPdfCanvasUnavailable",
            );
          }
          context.fillWhite(canvas.width, canvas.height);
          const intersections = planPdfTileIntersections(page.sourceRectCss, payload.tiles);
          for (const intersection of intersections) {
            const record = recordByIndex.get(intersection.tileIndex);
            const tile = payload.tiles.find(
              (candidate) => candidate.index === intersection.tileIndex,
            );
            if (record?.blob === undefined || tile === undefined) {
              throw storageReadError("A PDF page tile disappeared during streamed export.", {
                jobId: payload.jobId.slice(0, 24),
                tileIndex: intersection.tileIndex,
              });
            }

            const decoded = await this.environment.decode(record.blob);
            activeDecodedTiles += 1;
            decodedTileCount += 1;
            maxDecodedTiles = Math.max(maxDecodedTiles, activeDecodedTiles);
            sampleHeap();
            try {
              const captureViewport = tile.captureViewportCss ?? tile.sourceRectCss;
              const tileScaleX = positiveScale(decoded.width / captureViewport.width, "x");
              const tileScaleY = positiveScale(decoded.height / captureViewport.height, "y");
              const sourceX = roundRange(
                intersection.sourceCropCss.x * tileScaleX,
                (intersection.sourceCropCss.x + intersection.sourceCropCss.width) * tileScaleX,
                decoded.width,
              );
              const sourceY = roundRange(
                intersection.sourceCropCss.y * tileScaleY,
                (intersection.sourceCropCss.y + intersection.sourceCropCss.height) * tileScaleY,
                decoded.height,
              );
              const globalDestinationX = roundRange(
                (intersection.logicalRectCss.x - payload.targetRect.x) * renderScaleX,
                (intersection.logicalRectCss.x +
                  intersection.logicalRectCss.width -
                  payload.targetRect.x) *
                  renderScaleX,
                totalPixelWidth,
              );
              const globalDestinationY = roundRange(
                (intersection.logicalRectCss.y - payload.targetRect.y) * renderScaleY,
                (intersection.logicalRectCss.y +
                  intersection.logicalRectCss.height -
                  payload.targetRect.y) *
                  renderScaleY,
                totalPixelHeight,
              );
              const destinationX = globalDestinationX.start - pixelXRange.start;
              const destinationY = globalDestinationY.start - pixelYRange.start;
              if (
                sourceX.length <= 0 ||
                sourceY.length <= 0 ||
                globalDestinationX.length <= 0 ||
                globalDestinationY.length <= 0 ||
                destinationX < 0 ||
                destinationX + globalDestinationX.length > canvas.width ||
                destinationY < 0 ||
                destinationY + globalDestinationY.length > canvas.height
              ) {
                throw exportError(
                  "A streamed PDF tile crop is empty or outside the page.",
                  "StreamingPdfTileCropInvalid",
                );
              }
              context.drawImage(
                decoded,
                sourceX.start,
                sourceY.start,
                sourceX.length,
                sourceY.length,
                destinationX,
                destinationY,
                globalDestinationX.length,
                globalDestinationY.length,
              );
            } finally {
              activeDecodedTiles -= 1;
              decoded.close();
              sampleHeap();
            }
          }

          const jpegBlob = await canvas.convertToJpeg(payload.settings.jpegQuality);
          if (jpegBlob.size <= 0) {
            throw exportError("The streamed PDF page JPEG is empty.", "StreamingPdfPageJpegEmpty");
          }
          const raster = await this.spool.writeRasterPage(
            payload.outputArtifactId,
            outputIndex,
            jpegBlob,
          );
          rasterReference = raster.reference;
          rasterReferences.add(raster.reference);

          const checkpoint = await writer.addJpegPage({
            jpeg: raster.blob,
            pixelWidth: canvasWidth,
            pixelHeight: canvasHeight,
            pageWidthPt: page.pageWidthPt,
            pageHeightPt: page.pageHeightPt,
            imageRectPt: page.imageRectPt,
          });
          const now = new Date();
          const durableCheckpoint: PdfWriterCheckpoint = {
            schemaVersion: 1,
            jobId: payload.jobId,
            outputArtifactId: payload.outputArtifactId,
            spoolReference: checkpoint.spoolReference,
            pagesWritten: checkpoint.pagesWritten,
            totalPages: checkpoint.totalPages,
            byteLength: checkpoint.byteLength,
            createdAt: payload.createdAt,
            updatedAt: now.toISOString(),
            expiresAt: payload.expiresAt,
          };
          await this.checkpoints.put(durableCheckpoint);

          const accepted = await reportProgress({
            jobId: payload.jobId,
            completedPages: outputIndex + 1,
            totalPages: writerPages.length,
          });
          if (!accepted) throw cancelledError(payload.jobId);
          await this.spool.delete(raster.reference);
          rasterReferences.delete(raster.reference);
          rasterReference = undefined;
        } finally {
          canvas.release();
          releasedCanvasCount += 1;
          sampleHeap();
          if (rasterReference !== undefined) {
            await this.spool.delete(rasterReference).catch(() => undefined);
            rasterReferences.delete(rasterReference);
          }
        }
      }

      const finalized = await writer.finalize();
      const finalCheckpoint: PdfWriterCheckpoint = {
        schemaVersion: 1,
        jobId: payload.jobId,
        outputArtifactId: payload.outputArtifactId,
        spoolReference: finalized.checkpoint.spoolReference,
        pagesWritten: finalized.checkpoint.pagesWritten,
        totalPages: finalized.checkpoint.totalPages,
        byteLength: finalized.checkpoint.byteLength,
        createdAt: payload.createdAt,
        updatedAt: new Date().toISOString(),
        expiresAt: payload.expiresAt,
      };
      await this.checkpoints.put(finalCheckpoint);
      const integrity = await assertStreamingPdfStructure(finalized.file.blob, writerPages.length);
      const firstPage = writerPages[0];
      if (firstPage === undefined) {
        throw exportError(
          "Streamed PDF output page metadata is unavailable.",
          "StreamingPdfPagesMissing",
        );
      }

      const record: ArtifactRecord = {
        artifactId: payload.outputArtifactId,
        sourceArtifactId: payload.jobId,
        jobId: payload.jobId,
        role: "output",
        format: "pdf",
        mimeType: "application/pdf",
        filename: payload.filename,
        byteLength: finalized.file.byteLength,
        width: Math.max(1, Math.round(firstPage.pageWidthPt)),
        height: Math.max(1, Math.round(firstPage.pageHeightPt)),
        pageCount: writerPages.length,
        createdAt: payload.createdAt,
        expiresAt: payload.expiresAt,
        opfsReference: finalized.file.reference,
        ...(payload.sourceTitle === undefined ? {} : { sourceTitle: payload.sourceTitle }),
        ...(payload.sourceDomain === undefined ? {} : { sourceDomain: payload.sourceDomain }),
      };
      await this.artifacts.put(record);
      const durationMs = Math.max(0, nowMilliseconds(this.environment) - startedAt);
      return {
        artifact: artifactMetadata(record),
        diagnostics: {
          pageCount: writerPages.length,
          decodedTileCount,
          maxDecodedTiles,
          maxCanvasPixelArea,
          releasedCanvasCount,
          durationMs,
          artifactBytes: finalized.file.byteLength,
          memoryEstimate,
          integrity: {
            valid: integrity.valid,
            pageCount: integrity.pageCount,
            imageObjectCount: writerPages.length,
            nonEmptyStreamCount: writerPages.length * 2,
          },
          ...(peakHeapBytes === undefined ? {} : { peakHeapBytes }),
          ...(heapLimitBytes === undefined ? {} : { heapLimitBytes }),
        },
      };
    } catch (error) {
      await writer.abort().catch(() => undefined);
      for (const reference of rasterReferences) {
        await this.spool.delete(reference).catch(() => undefined);
      }
      throw error;
    }
  }
}
