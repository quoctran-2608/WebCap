import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { ImageFormat } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

import { buildCaptureFilename } from "./filename";
import type { DownloadService } from "./download-service";
import type { OffscreenService } from "./offscreen-service";

export interface ImageExportServiceOptions {
  artifacts: ArtifactRepositoryPort;
  offscreen: OffscreenService;
  downloads: DownloadService;
  now?: () => Date;
  createId?: () => string;
  artifactTtlMs?: number;
  completedRequestLimit?: number;
}

export interface ExportCaptureOptions {
  requestId: string;
  sourceArtifactId: string;
  format: ImageFormat;
  quality: number;
}

const DEFAULT_ARTIFACT_TTL_MS = 30 * 60 * 1000;

function sourceMissingError(sourceArtifactId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The captured source artifact is no longer available.",
      userMessageKey: "errors.storageRead",
      retryable: false,
      fallbackAllowed: false,
      safeContext: { sourceArtifactId: sourceArtifactId.slice(0, 24) },
    }),
  );
}

function rememberBounded<T>(map: Map<string, T>, key: string, value: T, limit: number): void {
  map.set(key, value);
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    map.delete(oldestKey);
  }
}

export class ImageExportService {
  private readonly artifacts: ArtifactRepositoryPort;
  private readonly offscreen: OffscreenService;
  private readonly downloads: DownloadService;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly artifactTtlMs: number;
  private readonly completedRequestLimit: number;
  private readonly inFlight = new Map<string, Promise<ArtifactMetadata>>();
  private readonly completed = new Map<string, ArtifactMetadata>();

  constructor(options: ImageExportServiceOptions) {
    this.artifacts = options.artifacts;
    this.offscreen = options.offscreen;
    this.downloads = options.downloads;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.artifactTtlMs = options.artifactTtlMs ?? DEFAULT_ARTIFACT_TTL_MS;
    this.completedRequestLimit = options.completedRequestLimit ?? 32;
  }

  exportCapture(options: ExportCaptureOptions): Promise<ArtifactMetadata> {
    const completed = this.completed.get(options.requestId);
    if (completed !== undefined) {
      return Promise.resolve(completed);
    }

    const active = this.inFlight.get(options.requestId);
    if (active !== undefined) {
      return active;
    }

    const operation = this.process(options).finally(() => {
      this.inFlight.delete(options.requestId);
    });
    this.inFlight.set(options.requestId, operation);
    return operation;
  }

  downloadArtifact(artifactId: string): Promise<number> {
    return this.downloads.download(artifactId);
  }

  private async process(options: ExportCaptureOptions): Promise<ArtifactMetadata> {
    const source = await this.artifacts.get(options.sourceArtifactId);
    if (source === undefined || source.role !== "source") {
      throw sourceMissingError(options.sourceArtifactId);
    }

    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.artifactTtlMs);
    const artifact = await this.offscreen.processImage({
      sourceArtifactId: source.artifactId,
      outputArtifactId: this.createId(),
      format: options.format,
      quality: options.quality,
      filename: buildCaptureFilename({
        ...(source.sourceTitle === undefined ? {} : { title: source.sourceTitle }),
        ...(source.sourceDomain === undefined ? {} : { domain: source.sourceDomain }),
        createdAt,
        format: options.format,
      }),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    rememberBounded(this.completed, options.requestId, artifact, this.completedRequestLimit);
    return artifact;
  }
}
