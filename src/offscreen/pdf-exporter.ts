import { PDFDocument } from "pdf-lib";

import type { ArtifactMetadata, ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureSettings, CaptureTile, Rect } from "@shared/contracts/domain";
import type { PdfEditorPage } from "@shared/contracts/pdf-editor";
import {
  WebCapRuntimeError,
  createWebCapError,
  createWebCapRuntimeError,
} from "@shared/errors/error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

import {
  assertPdfIntegrity,
  type PdfIntegrityExpectations,
  type PdfIntegrityReport,
} from "./pdf-integrity";
import { planPdfDocument } from "./pdf-layout";
import { assertPdfExportMemorySafe, type PdfMemoryEstimate } from "./pdf-memory-guard";
import { planPdfTileIntersections } from "./pdf-tile-intersections";

export interface PdfExportPayload {
  jobId: string;
  outputArtifactId: string;
  targetRect: Rect;
  tiles: CaptureTile[];
  settings: CaptureSettings["pdf"];
  pages?: PdfEditorPage[] | undefined;
  filename: string;
  createdAt: string;
  expiresAt: string;
  sourceTitle?: string | undefined;
  sourceDomain?: string | undefined;
}

export interface PdfExportProgress {
  jobId: string;
  completedPages: number;
  totalPages: number;
}

export interface DecodedPdfTile {
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
}

export interface PdfPageCanvasContextPort {
  fillWhite(width: number, height: number): void;
  drawImage(
    image: DecodedPdfTile,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    destinationX: number,
    destinationY: number,
    destinationWidth: number,
    destinationHeight: number,
  ): void;
}

export interface PdfPageCanvasPort {
  width: number;
  height: number;
  getContext(): PdfPageCanvasContextPort | null;
  convertToJpeg(quality: number): Promise<Blob>;
  release(): void;
}

export interface PdfDocumentPort {
  addJpegPage(options: {
    bytes: Uint8Array;
    pageWidthPt: number;
    pageHeightPt: number;
    imageRectPt: Rect;
  }): Promise<void>;
  save(): Promise<Uint8Array>;
}

export interface PdfHeapSnapshot {
  usedBytes?: number | undefined;
  limitBytes?: number | undefined;
}

export interface PdfExportEnvironment {
  decode(blob: Blob): Promise<DecodedPdfTile>;
  createCanvas(width: number, height: number): PdfPageCanvasPort;
  createDocument(): Promise<PdfDocumentPort>;
  now?: (() => number) | undefined;
  readHeapSnapshot?: (() => PdfHeapSnapshot) | undefined;
}

export type PdfIntegrityInspector = (
  input: Uint8Array | ArrayBuffer,
  expectations?: PdfIntegrityExpectations,
) => Promise<PdfIntegrityReport>;

export interface PdfExporterOptions {
  tiles: TileRepositoryPort;
  artifacts: ArtifactRepositoryPort;
  environment?: PdfExportEnvironment;
  inspectIntegrity?: PdfIntegrityInspector;
}

export interface PdfExportDiagnostics {
  pageCount: number;
  decodedTileCount: number;
  maxDecodedTiles: number;
  maxCanvasPixelArea: number;
  releasedCanvasCount: number;
  durationMs: number;
  artifactBytes: number;
  memoryEstimate: PdfMemoryEstimate;
  integrity: {
    valid: boolean;
    pageCount: number;
    imageObjectCount: number;
    nonEmptyStreamCount: number;
  };
  peakHeapBytes?: number | undefined;
  heapLimitBytes?: number | undefined;
}

export interface PdfExportResult {
  artifact: ArtifactMetadata;
  diagnostics: PdfExportDiagnostics;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

const defaultEnvironment: PdfExportEnvironment = {
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
  async createDocument() {
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

function exportError(message: string, causeCode?: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message,
      userMessageKey: "errors.exportFailed",
      retryable: true,
      fallbackAllowed: false,
      ...(causeCode === undefined ? {} : { causeCode }),
    }),
  );
}

function cancelledError(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_CANCELLED",
      stage: "export",
      message: "PDF export was cancelled before the output artifact was saved.",
      userMessageKey: "errors.cancelled",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "PdfExportCancelled",
      safeContext: { jobId: jobId.slice(0, 24) },
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

function positiveScale(value: number, axis: "x" | "y"): number {
  if (!Number.isFinite(value) || value <= 0 || value > 8) {
    throw exportError(`The PDF ${axis}-axis tile scale is invalid.`, "InvalidPdfTileScale");
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

function nowMilliseconds(environment: PdfExportEnvironment): number {
  const value = environment.now?.() ?? Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

function readHeapSnapshot(environment: PdfExportEnvironment): PdfHeapSnapshot {
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

export class PdfExporter {
  private readonly tiles: TileRepositoryPort;
  private readonly artifacts: ArtifactRepositoryPort;
  private readonly environment: PdfExportEnvironment;
  private readonly inspectIntegrity: PdfIntegrityInspector;

  constructor(options: PdfExporterOptions) {
    this.tiles = options.tiles;
    this.artifacts = options.artifacts;
    this.environment = options.environment ?? defaultEnvironment;
    this.inspectIntegrity = options.inspectIntegrity ?? assertPdfIntegrity;
  }

  async export(
    payload: PdfExportPayload,
    reportProgress: (progress: PdfExportProgress) => Promise<boolean> = () => Promise.resolve(true),
  ): Promise<PdfExportResult> {
    const startedAt = nowMilliseconds(this.environment);
    const records = await this.tiles.listByJob(payload.jobId);
    const recordByIndex = new Map(records.map((record) => [record.index, record]));
    let tileBytes = 0;
    for (const tile of payload.tiles) {
      const record = recordByIndex.get(tile.index);
      if (record?.blob === undefined || record.tile.status !== "stored") {
        throw storageReadError("A stored capture tile is unavailable for PDF export.", {
          jobId: payload.jobId.slice(0, 24),
          tileIndex: tile.index,
        });
      }
      tileBytes += record.blob.size;
    }

    const firstTile = payload.tiles[0];
    if (firstTile === undefined) {
      throw exportError("PDF export requires at least one stored capture tile.", "PdfTilesMissing");
    }
    const pages = payload.pages ?? defaultEditorPages(payload);
    if (pages.length === 0) {
      throw exportError("PDF export requires at least one selected page.", "PdfPagesMissing");
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
    const pagePixelRanges = pages.map((page) => {
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
        throw exportError("PDF page pixel range is empty.", "PdfPagePixelRangeMissing");
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
    const memoryEstimate = assertPdfExportMemorySafe({
      widthCss: Math.max(...pages.map((page) => page.sourceRectCss.width)),
      heightCss: Math.max(...pages.map((page) => page.sourceRectCss.height)),
      renderScaleX,
      renderScaleY,
      tileCount: payload.tiles.length,
      tileBytes,
      pageCount: pages.length,
      maxPagePixelArea,
      largestTilePixelArea,
      jpegQuality: payload.settings.jpegQuality,
      ...(initialHeap.limitBytes === undefined ? {} : { heapLimitBytes: initialHeap.limitBytes }),
    });
    const pdf = await this.environment.createDocument();

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

    try {
      for (const [outputIndex, entry] of pagePixelRanges.entries()) {
        const { page, pixelXRange, pixelYRange } = entry;
        const canvas = this.environment.createCanvas(pixelXRange.length, pixelYRange.length);
        maxCanvasPixelArea = Math.max(maxCanvasPixelArea, canvas.width * canvas.height);
        sampleHeap();
        try {
          const context = canvas.getContext();
          if (context === null) {
            throw exportError(
              "WebCap could not create a PDF page canvas context.",
              "PdfCanvasUnavailable",
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
              throw storageReadError("A PDF page tile disappeared during export.", {
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
              const destinationX = globalDestinationX.start - pixelXRange.start;
              const globalDestinationY = roundRange(
                (intersection.logicalRectCss.y - payload.targetRect.y) * renderScaleY,
                (intersection.logicalRectCss.y +
                  intersection.logicalRectCss.height -
                  payload.targetRect.y) *
                  renderScaleY,
                totalPixelHeight,
              );
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
                  "PDF tile crop produced an empty or out-of-page rectangle.",
                  "PdfTileCropInvalid",
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
            throw exportError("The encoded PDF page JPEG is empty.", "EmptyPdfPageJpeg");
          }
          await pdf.addJpegPage({
            bytes: new Uint8Array(await jpegBlob.arrayBuffer()),
            pageWidthPt: page.pageWidthPt,
            pageHeightPt: page.pageHeightPt,
            imageRectPt: page.imageRectPt,
          });
          sampleHeap();
        } finally {
          canvas.release();
          releasedCanvasCount += 1;
          sampleHeap();
        }

        const accepted = await reportProgress({
          jobId: payload.jobId,
          completedPages: outputIndex + 1,
          totalPages: pages.length,
        });
        if (!accepted) {
          throw cancelledError(payload.jobId);
        }
      }

      const bytes = await pdf.save();
      if (bytes.byteLength <= 0) {
        throw exportError("The generated PDF artifact is empty.", "EmptyPdfArtifact");
      }
      sampleHeap();
      const ownedBytes = Uint8Array.from(bytes);
      const integrity = await this.inspectIntegrity(ownedBytes, {
        pageCount: pages.length,
        pageSizes: pages.map((page) => ({
          widthPt: page.pageWidthPt,
          heightPt: page.pageHeightPt,
        })),
        dimensionTolerancePt: 0.5,
        requireImagePerPage: true,
      });
      if (!integrity.valid) {
        throw exportError(
          `The generated PDF failed integrity validation: ${integrity.errors.join(",")}.`,
          "PdfIntegrityCheckFailed",
        );
      }
      const blob = new Blob([ownedBytes.buffer], { type: "application/pdf" });
      const firstPage = pages[0];
      if (firstPage === undefined) {
        throw exportError("PDF output page metadata is unavailable.", "PdfPagesMissing");
      }
      const record: ArtifactRecord = {
        artifactId: payload.outputArtifactId,
        sourceArtifactId: payload.jobId,
        jobId: payload.jobId,
        role: "output",
        format: "pdf",
        mimeType: "application/pdf",
        filename: payload.filename,
        byteLength: blob.size,
        width: Math.max(1, Math.round(firstPage.pageWidthPt)),
        height: Math.max(1, Math.round(firstPage.pageHeightPt)),
        pageCount: pages.length,
        createdAt: payload.createdAt,
        expiresAt: payload.expiresAt,
        blob,
        ...(payload.sourceTitle === undefined ? {} : { sourceTitle: payload.sourceTitle }),
        ...(payload.sourceDomain === undefined ? {} : { sourceDomain: payload.sourceDomain }),
      };
      await this.artifacts.put(record);
      const artifact: ArtifactMetadata = {
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
      const durationMs = Math.max(0, nowMilliseconds(this.environment) - startedAt);
      return {
        artifact,
        diagnostics: {
          pageCount: pages.length,
          decodedTileCount,
          maxDecodedTiles,
          maxCanvasPixelArea,
          releasedCanvasCount,
          durationMs,
          artifactBytes: blob.size,
          memoryEstimate,
          integrity: {
            valid: integrity.valid,
            pageCount: integrity.pageCount,
            imageObjectCount: integrity.imageObjectCount,
            nonEmptyStreamCount: integrity.nonEmptyStreamCount,
          },
          ...(peakHeapBytes === undefined ? {} : { peakHeapBytes }),
          ...(heapLimitBytes === undefined ? {} : { heapLimitBytes }),
        },
      };
    } catch (error) {
      if (error instanceof WebCapRuntimeError) {
        throw error;
      }
      throw exportError(
        error instanceof Error && error.message.length > 0
          ? error.message
          : "WebCap could not create the PDF artifact.",
        error instanceof Error ? error.name : "PdfExportFailed",
      );
    }
  }
}
