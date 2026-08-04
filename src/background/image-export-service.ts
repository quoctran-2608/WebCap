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

function exportCancelledError(sourceArtifactId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_CANCELLED",
      stage: "process",
      message: "The image export was cancelled because the capture was reset.",
      userMessageKey: "errors.cancelled",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "CaptureReset",
      safeContext: { sourceArtifactId: sourceArtifactId.slice(0, 24) },
    }),
  );
}

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
  private readonly inFlight = new Map<
    string,
    { sourceArtifactId: string; promise: Promise<ArtifactMetadata> }
  >();
  private readonly completed = new Map<string, ArtifactMetadata>();
  private readonly cancelledSources = new Set<string>();

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
      return active.promise;
    }

    if (this.cancelledSources.has(options.sourceArtifactId)) {
      return Promise.reject(exportCancelledError(options.sourceArtifactId));
    }

    const operation = this.process(options).finally(() => {
      this.inFlight.delete(options.requestId);
    });
    this.inFlight.set(options.requestId, {
      sourceArtifactId: options.sourceArtifactId,
      promise: operation,
    });
    return operation;
  }

  downloadArtifact(artifactId: string): Promise<number> {
    return this.downloads.download(artifactId);
  }

  async cancelBySourceArtifactId(sourceArtifactId: string): Promise<void> {
    this.cancelledSources.add(sourceArtifactId);

    const completedArtifacts = [...this.completed.entries()].filter(
      ([, artifact]) => artifact.sourceArtifactId === sourceArtifactId,
    );
    for (const [requestId, artifact] of completedArtifacts) {
      this.completed.delete(requestId);
      await this.artifacts.delete(artifact.artifactId).catch(() => false);
    }

    const active = [...this.inFlight.values()]
      .filter((operation) => operation.sourceArtifactId === sourceArtifactId)
      .map((operation) => operation.promise.catch(() => undefined));
    await Promise.all(active);
  }

  private async process(options: ExportCaptureOptions): Promise<ArtifactMetadata> {
    if (this.cancelledSources.has(options.sourceArtifactId)) {
      throw exportCancelledError(options.sourceArtifactId);
    }
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
    if (this.cancelledSources.has(options.sourceArtifactId)) {
      await this.artifacts.delete(artifact.artifactId).catch(() => false);
      throw exportCancelledError(options.sourceArtifactId);
    }
    rememberBounded(this.completed, options.requestId, artifact, this.completedRequestLimit);
    return artifact;
  }
}
