import { buildCaptureFilename } from "@background/filename";
import type { ExportTiledImageOptions } from "@background/offscreen-service";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureJob, ImageFormat } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

import { captureOutputFromArtifact } from "./capture-output";
import type { PersistentJobCoordinatorPort } from "./job-coordinator";

export interface TiledImageOffscreenPort {
  exportTiledImage(options: ExportTiledImageOptions): Promise<ArtifactMetadata>;
}

export interface TiledImageExportServiceOptions {
  jobs: PersistentJobCoordinatorPort;
  offscreen: TiledImageOffscreenPort;
  artifacts?: Pick<ArtifactRepositoryPort, "delete">;
  now?: () => Date;
  createId?: () => string;
  artifactTtlMs?: number;
}

const DEFAULT_ARTIFACT_TTL_MS = 30 * 60 * 1000;

function sourceError(jobId: string, causeCode: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The stored capture tiles required for image export are unavailable.",
      userMessageKey: "errors.storageRead",
      retryable: true,
      fallbackAllowed: false,
      causeCode,
      safeContext: { jobId: jobId.slice(0, 24) },
    }),
  );
}

function jobNotReadyError(job: CaptureJob): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message: "The capture job is not ready for tiled image export.",
      userMessageKey: "errors.exportNotReady",
      retryable: job.state === "failed",
      fallbackAllowed: false,
      causeCode: "TiledImageExportJobNotReady",
      safeContext: { jobId: job.id.slice(0, 24), state: job.state },
    }),
  );
}

function domainFromOrigin(origin: string | undefined): string | undefined {
  if (origin === undefined) return undefined;
  try {
    return new URL(origin).hostname || undefined;
  } catch {
    return undefined;
  }
}

export class TiledImageExportService {
  private readonly jobs: PersistentJobCoordinatorPort;
  private readonly offscreen: TiledImageOffscreenPort;
  private readonly artifacts: Pick<ArtifactRepositoryPort, "delete"> | undefined;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly artifactTtlMs: number;
  private readonly operations = new Map<string, Promise<void>>();
  private readonly cancelledJobs = new Set<string>();

  constructor(options: TiledImageExportServiceOptions) {
    this.jobs = options.jobs;
    this.offscreen = options.offscreen;
    this.artifacts = options.artifacts;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.artifactTtlMs = options.artifactTtlMs ?? DEFAULT_ARTIFACT_TTL_MS;
  }

  async start(jobId: string, format: ImageFormat, quality?: number): Promise<CaptureJob> {
    const current = await this.jobs.get(jobId);
    if (current === undefined) throw sourceError(jobId, "TiledImageExportJobMissing");
    if (current.state === "completed" && current.outputArtifactId !== undefined) return current;
    if (current.state === "exporting") return current;
    if (
      !["ready", "failed"].includes(current.state) ||
      current.targetRect === undefined ||
      current.tilePlan.length === 0
    ) {
      throw jobNotReadyError(current);
    }

    this.cancelledJobs.delete(jobId);
    const exporting = await this.jobs.transition(
      jobId,
      "exporting",
      {
        activeOutputFormat: format,
        error: undefined,
        output: undefined,
        outputArtifactId: undefined,
        exportProgress: { completedPages: 0, totalPages: 1 },
      },
      { sourceArtifactExists: true },
    );
    if (!this.operations.has(jobId)) {
      const operation = this.run(exporting, format, quality ?? current.settings.imageQuality).finally(
        () => {
          this.operations.delete(jobId);
          this.cancelledJobs.delete(jobId);
        },
      );
      this.operations.set(jobId, operation);
      void operation.catch(() => undefined);
    }
    return exporting;
  }

  async cancel(jobId: string): Promise<CaptureJob> {
    const job = await this.jobs.get(jobId);
    if (job === undefined) throw sourceError(jobId, "TiledImageExportJobMissing");
    if (job.state !== "exporting") return job;
    this.cancelledJobs.add(jobId);
    return this.jobs.transition(jobId, "ready", {
      exportProgress: job.exportProgress ?? { completedPages: 0, totalPages: 1 },
    });
  }

  async waitForIdle(jobId: string): Promise<void> {
    await this.operations.get(jobId)?.catch(() => undefined);
  }

  private async run(job: CaptureJob, format: ImageFormat, quality: number): Promise<void> {
    const targetRect = job.targetRect;
    if (targetRect === undefined) throw sourceError(job.id, "TiledImageExportTargetMissing");
    const createdAt = this.now();
    const sourceDomain = domainFromOrigin(job.source.origin);
    const outputArtifactId = this.createId();
    try {
      const artifact = await this.offscreen.exportTiledImage({
        jobId: job.id,
        outputArtifactId,
        targetRect,
        tiles: job.tilePlan,
        format,
        quality,
        filename: buildCaptureFilename({
          ...(job.source.title === undefined ? {} : { title: job.source.title }),
          ...(sourceDomain === undefined ? {} : { domain: sourceDomain }),
          createdAt,
          format,
        }),
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + this.artifactTtlMs).toISOString(),
        ...(job.source.title === undefined ? {} : { sourceTitle: job.source.title }),
        ...(sourceDomain === undefined ? {} : { sourceDomain }),
      });
      const latest = await this.jobs.get(job.id);
      if (
        latest?.state !== "exporting" ||
        latest.activeOutputFormat !== format ||
        this.cancelledJobs.has(job.id)
      ) {
        await this.artifacts?.delete(artifact.artifactId).catch(() => false);
        return;
      }
      await this.jobs.transition(job.id, "completed", {
        activeOutputFormat: format,
        outputArtifactId: artifact.artifactId,
        output: captureOutputFromArtifact(artifact),
        exportProgress: { completedPages: 1, totalPages: 1 },
      });
    } catch (error) {
      const latest = await this.jobs.get(job.id);
      if (latest?.state !== "exporting" || this.cancelledJobs.has(job.id)) return;
      await this.jobs.transition(job.id, "failed", {
        activeOutputFormat: format,
        error: normalizeError(error, {
          code: "E_EXPORT_FAILED",
          stage: "export",
          userMessageKey: "errors.exportFailed",
          retryable: true,
          fallbackAllowed: false,
          safeContext: { jobId: job.id.slice(0, 24) },
        }),
      });
    }
  }
}
