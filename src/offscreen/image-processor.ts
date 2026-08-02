import {
  mimeTypeForFormat,
  type ArtifactMetadata,
  type ArtifactRecord,
} from "@shared/contracts/artifact";
import type { OffscreenProcessImageMessage } from "@shared/contracts/offscreen";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

export interface DecodedImage {
  width: number;
  height: number;
  close(): void;
}

export interface Canvas2dPort {
  drawImage(image: DecodedImage, dx: number, dy: number): void;
}

export interface CanvasPort {
  getContext(contextId: "2d"): Canvas2dPort | null;
  convertToBlob(options: { type: string; quality?: number }): Promise<Blob>;
}

export interface ImageProcessingEnvironment {
  decode(blob: Blob): Promise<DecodedImage>;
  createCanvas(width: number, height: number): CanvasPort;
}

export interface ImageProcessorOptions {
  artifacts: ArtifactRepositoryPort;
  environment?: ImageProcessingEnvironment;
}

const defaultEnvironment: ImageProcessingEnvironment = {
  decode: (blob) => createImageBitmap(blob),
  createCanvas: (width, height) => new OffscreenCanvas(width, height),
};

function processingError(message: string, causeCode?: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "process",
      message,
      userMessageKey: "errors.exportFailed",
      retryable: true,
      fallbackAllowed: false,
      ...(causeCode === undefined ? {} : { causeCode }),
    }),
  );
}

function sourceMissingError(sourceArtifactId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The source artifact could not be read for image processing.",
      userMessageKey: "errors.storageRead",
      retryable: false,
      fallbackAllowed: false,
      safeContext: { sourceArtifactId: sourceArtifactId.slice(0, 24) },
    }),
  );
}

export class ImageProcessor {
  private readonly artifacts: ArtifactRepositoryPort;
  private readonly environment: ImageProcessingEnvironment;

  constructor(options: ImageProcessorOptions) {
    this.artifacts = options.artifacts;
    this.environment = options.environment ?? defaultEnvironment;
  }

  async process(payload: OffscreenProcessImageMessage["payload"]): Promise<ArtifactMetadata> {
    const source = await this.artifacts.get(payload.sourceArtifactId);
    if (source === undefined || source.role !== "source") {
      throw sourceMissingError(payload.sourceArtifactId);
    }

    let bitmap: DecodedImage | undefined;
    try {
      bitmap = await this.environment.decode(source.blob);
      const canvas = this.environment.createCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (context === null) {
        throw processingError("WebCap could not create a 2D offscreen canvas context.");
      }

      context.drawImage(bitmap, 0, 0);
      const mimeType = mimeTypeForFormat(payload.format);
      const blob = await canvas.convertToBlob({
        type: mimeType,
        ...(payload.format === "png" ? {} : { quality: payload.quality }),
      });
      if (blob.size <= 0) {
        throw processingError("The encoded WebCap image artifact is empty.");
      }

      const record: ArtifactRecord = {
        artifactId: payload.outputArtifactId,
        sourceArtifactId: source.artifactId,
        jobId: source.jobId,
        role: "output",
        format: payload.format,
        mimeType,
        filename: payload.filename,
        byteLength: blob.size,
        width: bitmap.width,
        height: bitmap.height,
        createdAt: payload.createdAt,
        expiresAt: payload.expiresAt,
        blob,
        ...(source.sourceTitle === undefined ? {} : { sourceTitle: source.sourceTitle }),
        ...(source.sourceDomain === undefined ? {} : { sourceDomain: source.sourceDomain }),
      };
      await this.artifacts.put(record);

      const metadata: ArtifactMetadata = {
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
      return metadata;
    } catch (error) {
      if (error instanceof Error && "data" in error) {
        throw error;
      }
      throw processingError(
        error instanceof Error && error.message.length > 0
          ? error.message
          : "WebCap could not encode the image artifact.",
        error instanceof Error ? error.name : "ImageProcessingFailed",
      );
    } finally {
      bitmap?.close();
    }
  }
}
