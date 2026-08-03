import { buildCaptureFilename } from "@background/filename";
import { planPdfDocument } from "@offscreen/pdf-layout";
import type { PdfExportPayload, PdfExportProgress } from "@offscreen/pdf-exporter";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureJob, CaptureSettings } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import type { TileRepositoryPort } from "@storage/tile-repository";

import type { PersistentJobCoordinatorPort } from "./job-coordinator";

export interface PdfOffscreenPort {
  exportPdf(options: PdfExportPayload): Promise<ArtifactMetadata>;
}

export interface PdfExportServiceOptions {
  jobs: PersistentJobCoordinatorPort;
  tiles: TileRepositoryPort;
  offscreen: PdfOffscreenPort;
  now?: () => Date;
  createId?: () => string;
  artifactTtlMs?: number;
}

const DEFAULT_ARTIFACT_TTL_MS = 30 * 60 * 1000;

function jobNotReadyError(job: CaptureJob): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message: "The capture job is not ready for PDF export.",
      userMessageKey: "errors.exportNotReady",
      retryable: job.state === "failed",
      fallbackAllowed: false,
      causeCode: "PdfExportJobNotReady",
      safeContext: { jobId: job.id.slice(0, 24), state: job.state },
    }),
  );
}

function exportSourceError(jobId: string, causeCode: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The stored capture tiles required for PDF export are unavailable.",
      userMessageKey: "errors.storageRead",
      retryable: true,
      fallbackAllowed: false,
      causeCode,
      safeContext: { jobId: jobId.slice(0, 24) },
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

export class PdfExportService {
  private readonly jobs: PersistentJobCoordinatorPort;
  private readonly tiles: TileRepositoryPort;
  private readonly offscreen: PdfOffscreenPort;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly artifactTtlMs: number;
  private readonly operations = new Map<string, Promise<void>>();

  constructor(options: PdfExportServiceOptions) {
    this.jobs = options.jobs;
    this.tiles = options.tiles;
    this.offscreen = options.offscreen;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.artifactTtlMs = options.artifactTtlMs ?? DEFAULT_ARTIFACT_TTL_MS;
  }

  async start(
    jobId: string,
    settings?: CaptureSettings["pdf"],
  ): Promise<CaptureJob> {
    const current = await this.jobs.get(jobId);
    if (current === undefined) {
      throw exportSourceError(jobId, "PdfExportJobMissing");
    }
    if (current.state === "completed" && current.outputArtifactId !== undefined) {
      return current;
    }
    if (current.state === "exporting") {
      return current;
    }
    if (current.state !== "ready" || current.targetRect === undefined) {
      throw jobNotReadyError(current);
    }

    const records = await this.tiles.listByJob(jobId);
    const storedIndexes = new Set(
      records
        .filter((record) => record.blob !== undefined && record.tile.status === "stored")
        .map((record) => record.index),
    );
    if (
      current.tilePlan.length === 0 ||
      current.tilePlan.some((tile) => !storedIndexes.has(tile.index))
    ) {
      throw exportSourceError(jobId, "PdfExportTilesMissing");
    }

    const pdfSettings = settings ?? current.settings.pdf;
    const plan = planPdfDocument(current.targetRect, pdfSettings);
    const exporting = await this.jobs.transition(
      jobId,
      "exporting",
      {
        exportProgress: {
          completedPages: 0,
          totalPages: plan.pages.length,
        },
      },
      { sourceArtifactExists: true },
    );

    if (!this.operations.has(jobId)) {
      const operation = this.run(exporting, pdfSettings).finally(() => {
        this.operations.delete(jobId);
      });
      this.operations.set(jobId, operation);
      void operation.catch(() => undefined);
    }
    return exporting;
  }

  async handleProgress(progress: PdfExportProgress): Promise<CaptureJob | undefined> {
    const job = await this.jobs.get(progress.jobId);
    if (job === undefined || job.state !== "exporting") {
      return job;
    }
    const current = job.exportProgress;
    if (
      current !== undefined &&
      (progress.totalPages !== current.totalPages ||
        progress.completedPages < current.completedPages)
    ) {
      return job;
    }
    return this.jobs.update(job.id, {
      exportProgress: {
        completedPages: progress.completedPages,
        totalPages: progress.totalPages,
      },
    });
  }

  private async run(job: CaptureJob, settings: CaptureSettings["pdf"]): Promise<void> {
    const targetRect = job.targetRect;
    if (targetRect === undefined) {
      throw exportSourceError(job.id, "PdfExportTargetMissing");
    }
    const createdAt = this.now();
    const sourceDomain = domainFromOrigin(job.source.origin);
    const outputArtifactId = this.createId();
    try {
      const artifact = await this.offscreen.exportPdf({
        jobId: job.id,
        outputArtifactId,
        targetRect,
        tiles: job.tilePlan,
        settings,
        filename: buildCaptureFilename({
          ...(job.source.title === undefined ? {} : { title: job.source.title }),
          ...(sourceDomain === undefined ? {} : { domain: sourceDomain }),
          createdAt,
          format: "pdf",
        }),
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + this.artifactTtlMs).toISOString(),
        ...(job.source.title === undefined ? {} : { sourceTitle: job.source.title }),
        ...(sourceDomain === undefined ? {} : { sourceDomain }),
      });
      const latest = await this.jobs.get(job.id);
      if (latest?.state !== "exporting") {
        return;
      }
      await this.jobs.transition(job.id, "completed", {
        outputArtifactId: artifact.artifactId,
        exportProgress: {
          completedPages: artifact.pageCount ?? latest.exportProgress?.totalPages ?? 1,
          totalPages: artifact.pageCount ?? latest.exportProgress?.totalPages ?? 1,
        },
      });
    } catch (error) {
      const latest = await this.jobs.get(job.id);
      if (latest?.state !== "exporting") {
        return;
      }
      await this.jobs.transition(job.id, "failed", {
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
