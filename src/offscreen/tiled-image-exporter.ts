import {
  mimeTypeForFormat,
  type ArtifactMetadata,
  type ArtifactRecord,
} from "@shared/contracts/artifact";
import type { CaptureTile, ImageFormat, Rect } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

import { planPdfTileIntersections } from "./pdf-tile-intersections";

export interface TiledImageExportPayload {
  jobId: string;
  outputArtifactId: string;
  targetRect: Rect;
  tiles: CaptureTile[];
  format: ImageFormat;
  quality: number;
  filename: string;
  createdAt: string;
  expiresAt: string;
  sourceTitle?: string | undefined;
  sourceDomain?: string | undefined;
}

export interface DecodedTiledImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
}

export interface TiledImageCanvasContextPort {
  drawImage(
    image: DecodedTiledImage,
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

export interface TiledImageCanvasPort {
  width: number;
  height: number;
  getContext(): TiledImageCanvasContextPort | null;
  convertToBlob(options: { type: string; quality?: number }): Promise<Blob>;
  release(): void;
}

export interface TiledImageExportEnvironment {
  decode(blob: Blob): Promise<DecodedTiledImage>;
  createCanvas(width: number, height: number): TiledImageCanvasPort;
}

export interface TiledImageExportGuards {
  maxDimension: number;
  maxPixelArea: number;
  maxWorkingSetBytes: number;
}

export const DEFAULT_TILED_IMAGE_EXPORT_GUARDS: Readonly<TiledImageExportGuards> = Object.freeze({
  maxDimension: 16_384,
  maxPixelArea: 64_000_000,
  maxWorkingSetBytes: 512 * 1024 * 1024,
});

export interface TiledImageExporterOptions {
  tiles: TileRepositoryPort;
  artifacts: ArtifactRepositoryPort;
  environment?: TiledImageExportEnvironment;
  guards?: Partial<TiledImageExportGuards>;
}

const defaultEnvironment: TiledImageExportEnvironment = {
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
      convertToBlob: (options) => canvas.convertToBlob(options),
      release() {
        canvas.width = 1;
        canvas.height = 1;
      },
    };
  },
};

function imageTooLargeError(
  causeCode: string,
  safeContext: Record<string, string | number | boolean>,
): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_IMAGE_OUTPUT_TOO_LARGE",
      stage: "export",
      message: "The tiled capture is too large for a safe browser image canvas.",
      userMessageKey: "errors.imageOutputTooLarge",
      retryable: true,
      fallbackAllowed: true,
      causeCode,
      safeContext,
    }),
  );
}

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

function storageReadError(jobId: string, tileIndex: number): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "A stored capture tile is unavailable for image export.",
      userMessageKey: "errors.storageRead",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "TiledImageTileMissing",
      safeContext: { jobId: jobId.slice(0, 24), tileIndex },
    }),
  );
}

function positiveScale(value: number, axis: "x" | "y"): number {
  if (!Number.isFinite(value) || value <= 0 || value > 8) {
    throw exportError(`The tiled image ${axis}-axis scale is invalid.`, "InvalidImageTileScale");
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

function validateGuards(
  width: number,
  height: number,
  storedBytes: number,
  largestTilePixelArea: number,
  guards: TiledImageExportGuards,
): void {
  const pixelArea = width * height;
  const estimatedWorkingSetBytes =
    pixelArea * 4 + largestTilePixelArea * 4 + storedBytes + 32 * 1024 * 1024;
  if (width > guards.maxDimension || height > guards.maxDimension) {
    throw imageTooLargeError("ImageCanvasDimensionGuard", {
      width,
      height,
      maxDimension: guards.maxDimension,
    });
  }
  if (pixelArea > guards.maxPixelArea) {
    throw imageTooLargeError("ImageCanvasPixelGuard", {
      width,
      height,
      pixelArea,
      maxPixelArea: guards.maxPixelArea,
    });
  }
  if (estimatedWorkingSetBytes > guards.maxWorkingSetBytes) {
    throw imageTooLargeError("ImageWorkingSetGuard", {
      estimatedWorkingSetBytes,
      maxWorkingSetBytes: guards.maxWorkingSetBytes,
    });
  }
}

export class TiledImageExporter {
  private readonly tiles: TileRepositoryPort;
  private readonly artifacts: ArtifactRepositoryPort;
  private readonly environment: TiledImageExportEnvironment;
  private readonly guards: TiledImageExportGuards;

  constructor(options: TiledImageExporterOptions) {
    this.tiles = options.tiles;
    this.artifacts = options.artifacts;
    this.environment = options.environment ?? defaultEnvironment;
    this.guards = {
      ...DEFAULT_TILED_IMAGE_EXPORT_GUARDS,
      ...options.guards,
    };
  }

  async export(payload: TiledImageExportPayload): Promise<ArtifactMetadata> {
    const firstTile = payload.tiles[0];
    if (
      firstTile === undefined ||
      payload.targetRect.width <= 0 ||
      payload.targetRect.height <= 0
    ) {
      throw exportError(
        "Tiled image export requires a non-empty target and tile set.",
        "ImageTilesMissing",
      );
    }

    const records = await this.tiles.listByJob(payload.jobId);
    const recordByIndex = new Map(records.map((record) => [record.index, record]));
    let storedBytes = 0;
    for (const tile of payload.tiles) {
      const record = recordByIndex.get(tile.index);
      if (record?.blob === undefined || record.tile.status !== "stored") {
        throw storageReadError(payload.jobId, tile.index);
      }
      storedBytes += record.blob.size;
    }

    const renderScaleX = positiveScale(
      firstTile.expectedPixelWidth / firstTile.sourceRectCss.width,
      "x",
    );
    const renderScaleY = positiveScale(
      firstTile.expectedPixelHeight / firstTile.sourceRectCss.height,
      "y",
    );
    const width = Math.max(1, Math.round(payload.targetRect.width * renderScaleX));
    const height = Math.max(1, Math.round(payload.targetRect.height * renderScaleY));
    const largestTilePixelArea = Math.max(
      ...payload.tiles.map((tile) => tile.expectedPixelWidth * tile.expectedPixelHeight),
    );
    validateGuards(width, height, storedBytes, largestTilePixelArea, this.guards);

    let intersections: ReturnType<typeof planPdfTileIntersections>;
    try {
      intersections = planPdfTileIntersections(payload.targetRect, payload.tiles);
    } catch (error) {
      throw exportError(
        error instanceof Error ? error.message : "Tiled image seam validation failed.",
        "TiledImageSeamInvalid",
      );
    }

    const canvas = this.environment.createCanvas(width, height);
    try {
      const context = canvas.getContext();
      if (context === null) {
        throw exportError(
          "WebCap could not create a tiled image canvas context.",
          "ImageCanvasUnavailable",
        );
      }

      for (const intersection of intersections) {
        const tile = payload.tiles.find((candidate) => candidate.index === intersection.tileIndex);
        const record = recordByIndex.get(intersection.tileIndex);
        if (tile === undefined || record?.blob === undefined) {
          throw storageReadError(payload.jobId, intersection.tileIndex);
        }
        const decoded = await this.environment.decode(record.blob);
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
          const destinationX = roundRange(
            intersection.pageDestinationCss.x * renderScaleX,
            (intersection.pageDestinationCss.x + intersection.pageDestinationCss.width) *
              renderScaleX,
            width,
          );
          const destinationY = roundRange(
            intersection.pageDestinationCss.y * renderScaleY,
            (intersection.pageDestinationCss.y + intersection.pageDestinationCss.height) *
              renderScaleY,
            height,
          );
          if (
            sourceX.length <= 0 ||
            sourceY.length <= 0 ||
            destinationX.length <= 0 ||
            destinationY.length <= 0
          ) {
            throw exportError(
              "A tiled image intersection rounded to an empty pixel range.",
              "ImagePixelRangeEmpty",
            );
          }
          context.drawImage(
            decoded,
            sourceX.start,
            sourceY.start,
            sourceX.length,
            sourceY.length,
            destinationX.start,
            destinationY.start,
            destinationX.length,
            destinationY.length,
          );
        } finally {
          decoded.close();
        }
      }

      const mimeType = mimeTypeForFormat(payload.format);
      const blob = await canvas.convertToBlob({
        type: mimeType,
        ...(payload.format === "png" ? {} : { quality: payload.quality }),
      });
      if (blob.size <= 0) {
        throw exportError("The encoded tiled image artifact is empty.", "ImageArtifactEmpty");
      }
      const record: ArtifactRecord = {
        artifactId: payload.outputArtifactId,
        sourceArtifactId: payload.jobId,
        jobId: payload.jobId,
        role: "output",
        format: payload.format,
        mimeType,
        filename: payload.filename,
        byteLength: blob.size,
        width,
        height,
        createdAt: payload.createdAt,
        expiresAt: payload.expiresAt,
        blob,
        ...(payload.sourceTitle === undefined ? {} : { sourceTitle: payload.sourceTitle }),
        ...(payload.sourceDomain === undefined ? {} : { sourceDomain: payload.sourceDomain }),
      };
      await this.artifacts.put(record);
      return {
        artifactId: record.artifactId,
        sourceArtifactId: record.sourceArtifactId,
        format: record.format,
        mimeType: record.mimeType,
        filename: record.filename,
        byteLength: record.byteLength,
        width: record.width,
        height: record.height,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      };
    } finally {
      canvas.release();
    }
  }
}
