import { buildCaptureFilename } from "@background/filename";
import { planPdfDocument, planPdfDocumentPages } from "@offscreen/pdf-layout";
import type { PdfExportPayload, PdfExportProgress } from "@offscreen/pdf-exporter";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureJob, CaptureSettings } from "@shared/contracts/domain";
import type { PdfOutputPlan } from "@shared/contracts/pdf-capture";
import type { PdfEditorPage } from "@shared/contracts/pdf-editor";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import type { ArtifactRepositoryPort, JobArtifactLookupPort } from "@storage/artifact-repository";
import { validateCompletePdfMultipartSet } from "@shared/contracts/pdf-multipart";
import type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

import { captureOutputFromArtifact } from "./capture-output";
import type { PersistentJobCoordinatorPort } from "./job-coordinator";
import {
  isDedicatedViewerPdfJob,
  type PdfCaptureOrchestratorPort,
} from "./pdf-capture-orchestrator";
import { getPdfCaptureOrchestrator } from "./pdf-capture-runtime";

export interface PdfOffscreenPort {
  exportPdf(options: PdfExportPayload): Promise<ArtifactMetadata>;
}

export interface PdfExportServiceOptions {
  jobs: PersistentJobCoordinatorPort;
  tiles: TileRepositoryPort;
  offscreen: PdfOffscreenPort;
  manifests?: PdfEditManifestRepositoryPort;
  pdfDocuments?: PdfCaptureOrchestratorPort;
  artifacts?: Pick<ArtifactRepositoryPort, "delete"> &
    Partial<Pick<JobArtifactLookupPort, "listByJob">>;
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

function mappedEditorPages(
  job: CaptureJob,
  settings: CaptureSettings["pdf"],
): PdfEditorPage[] | undefined {
  const pageMap = job.documentPageMap;
  const target = job.targetRect;
  if (pageMap === undefined || target === undefined) return undefined;
  const right = target.x + target.width;
  const bottom = target.y + target.height;
  const pages = pageMap.pages.filter((page) => {
    const rect = page.sourceRectCss;
    return (
      rect.x >= target.x - 0.01 &&
      rect.y >= target.y - 0.01 &&
      rect.x + rect.width <= right + 0.01 &&
      rect.y + rect.height <= bottom + 0.01
    );
  });
  if (pages.length === 0) return [];
  return planPdfDocumentPages(
    {
      ...pageMap,
      complete: pages.length === pageMap.sourcePageCount,
      sourcePageCount: pages.length,
      pages: pages.map((page, index) => ({ ...page, index })),
    },
    settings,
  ).map((page) => ({
    id: `document-page-${page.index + 1}`,
    originalIndex: page.index,
    sourceRectCss: page.sourceRectCss,
    pageWidthPt: page.pageWidthPt,
    pageHeightPt: page.pageHeightPt,
    imageRectPt: page.imageRectPt,
  }));
}

export class PdfExportService {
  private readonly jobs: PersistentJobCoordinatorPort;
  private readonly tiles: TileRepositoryPort;
  private readonly offscreen: PdfOffscreenPort;
  private readonly manifests: PdfEditManifestRepositoryPort | undefined;
  private readonly pdfDocuments: PdfCaptureOrchestratorPort | undefined;
  private readonly artifacts:
    | (Pick<ArtifactRepositoryPort, "delete"> & Partial<Pick<JobArtifactLookupPort, "listByJob">>)
    | undefined;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly artifactTtlMs: number;
  private readonly operations = new Map<string, Promise<void>>();
  private readonly cancelledJobs = new Set<string>();

  constructor(options: PdfExportServiceOptions) {
    this.jobs = options.jobs;
    this.tiles = options.tiles;
    this.offscreen = options.offscreen;
    this.manifests = options.manifests;
    this.pdfDocuments = options.pdfDocuments ?? getPdfCaptureOrchestrator();
    this.artifacts = options.artifacts;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.artifactTtlMs = options.artifactTtlMs ?? DEFAULT_ARTIFACT_TTL_MS;
  }

  async start(jobId: string, settings?: CaptureSettings["pdf"]): Promise<CaptureJob> {
    const current = await this.jobs.get(jobId);
    if (current === undefined) throw exportSourceError(jobId, "PdfExportJobMissing");
    if (current.state === "completed" && current.outputArtifactId !== undefined) return current;
    if (current.state === "exporting" && this.operations.has(jobId)) return current;
    const resumablePaused =
      current.state === "paused" &&
      current.activeOutputFormat === "pdf" &&
      current.exportProgress !== undefined;
    if (!["ready", "failed", "exporting"].includes(current.state) && !resumablePaused) {
      throw jobNotReadyError(current);
    }
    if (current.targetRect === undefined) throw jobNotReadyError(current);

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

    const editManifest = settings === undefined ? await this.manifests?.load(jobId) : undefined;
    const pdfSettings = settings ?? editManifest?.settings ?? current.settings.pdf;
    const pages = editManifest?.pages ?? mappedEditorPages(current, pdfSettings);
    if (pages !== undefined && pages.length === 0) {
      throw exportSourceError(jobId, "PdfDocumentPagesUnavailable");
    }
    const totalPages =
      pages?.length ?? planPdfDocument(current.targetRect, pdfSettings).pages.length;

    if (isDedicatedViewerPdfJob(current) && current.partialCapture === undefined) {
      if (this.pdfDocuments === undefined) {
        throw exportSourceError(jobId, "PdfDocumentOrchestratorUnavailable");
      }
      const outputPlan: PdfOutputPlan | undefined =
        editManifest === undefined
          ? undefined
          : {
              kind: "editor",
              sourcePageIndexes: editManifest.pages.map((page) => page.originalIndex),
              editRevision: editManifest.revision,
            };
      await this.pdfDocuments.prepareViewerExport(current, outputPlan);
    }

    this.cancelledJobs.delete(jobId);
    const outputArtifactId = current.outputArtifactId ?? this.createId();
    const preservedProgress =
      current.exportProgress?.totalPages === totalPages
        ? current.exportProgress
        : { completedPages: 0, totalPages };
    let exporting: CaptureJob;
    if (current.state === "exporting") {
      exporting =
        current.outputArtifactId === outputArtifactId
          ? current
          : await this.jobs.update(jobId, { outputArtifactId });
    } else {
      exporting = await this.jobs.transition(
        jobId,
        "exporting",
        {
          activeOutputFormat: "pdf",
          error: undefined,
          output: undefined,
          outputArtifactId,
          exportProgress: resumablePaused ? preservedProgress : { completedPages: 0, totalPages },
        },
        { sourceArtifactExists: true },
      );
    }

    if (!this.operations.has(jobId)) {
      const operation = this.run(exporting, pdfSettings, pages).finally(() => {
        this.operations.delete(jobId);
        this.cancelledJobs.delete(jobId);
      });
      this.operations.set(jobId, operation);
      void operation.catch(() => undefined);
    }
    return exporting;
  }

  async cancel(jobId: string): Promise<CaptureJob> {
    const job = await this.jobs.get(jobId);
    if (job === undefined) throw exportSourceError(jobId, "PdfExportJobMissing");
    if (job.state !== "exporting") return job;
    this.cancelledJobs.add(jobId);
    return this.jobs.transition(jobId, "ready", {
      activeOutputFormat: undefined,
      outputArtifactId: undefined,
      output: undefined,
      error: undefined,
      exportProgress: job.exportProgress ?? { completedPages: 0, totalPages: 1 },
    });
  }

  async waitForIdle(jobId: string): Promise<void> {
    await this.operations.get(jobId)?.catch(() => undefined);
  }

  async handleProgress(progress: PdfExportProgress): Promise<CaptureJob | undefined> {
    if (this.cancelledJobs.has(progress.jobId)) return undefined;
    const job = await this.jobs.get(progress.jobId);
    if (job === undefined || job.state !== "exporting") return undefined;
    const current = job.exportProgress;
    if (
      current !== undefined &&
      (progress.totalPages !== current.totalPages ||
        progress.completedPages < current.completedPages)
    ) {
      return job;
    }
    await this.pdfDocuments?.recordOutputProgress(
      progress.jobId,
      progress.completedPages,
      progress.totalPages,
    );
    return this.jobs.update(
      job.id,
      {
        exportProgress: {
          completedPages: progress.completedPages,
          totalPages: progress.totalPages,
        },
      },
      { sourceArtifactExists: true },
    );
  }

  private async run(
    job: CaptureJob,
    settings: CaptureSettings["pdf"],
    pages?: PdfEditorPage[],
  ): Promise<void> {
    const targetRect = job.targetRect;
    if (targetRect === undefined) throw exportSourceError(job.id, "PdfExportTargetMissing");
    const createdAt = this.now();
    const sourceDomain = domainFromOrigin(job.source.origin);
    const outputArtifactId = job.outputArtifactId;
    if (outputArtifactId === undefined) {
      throw exportSourceError(job.id, "PdfOutputArtifactIdMissing");
    }
    try {
      const artifact = await this.offscreen.exportPdf({
        jobId: job.id,
        outputArtifactId,
        targetRect,
        tiles: job.tilePlan,
        settings,
        ...(pages === undefined ? {} : { pages }),
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
      if (latest?.state !== "exporting" || this.cancelledJobs.has(job.id)) {
        await this.artifacts?.delete(artifact.artifactId).catch(() => false);
        return;
      }

      const multipart = artifact.pdfPart;
      let completedPages = artifact.pageCount ?? latest.exportProgress?.totalPages ?? 1;
      if (multipart !== undefined) {
        const records = await this.artifacts?.listByJob?.(job.id);
        const group = records
          ?.filter((record) => record.pdfPart?.groupId === multipart.groupId)
          .map((record) => record.pdfPart)
          .filter((part): part is NonNullable<typeof part> => part !== undefined);
        const validation = validateCompletePdfMultipartSet(group ?? []);
        if (!validation.valid || validation.groupId !== multipart.groupId) {
          throw exportSourceError(job.id, "PdfMultipartArtifactsIncomplete");
        }
        completedPages = validation.documentPageCount;
      }
      const dedicated = isDedicatedViewerPdfJob(latest) && latest.partialCapture === undefined;
      const completionEvidence = dedicated
        ? await this.pdfDocuments?.completeViewerOutput(latest, completedPages)
        : undefined;
      if (dedicated && completionEvidence === undefined) {
        throw exportSourceError(job.id, "PdfDocumentCompletionEvidenceUnavailable");
      }

      await this.jobs.transition(
        job.id,
        "completed",
        {
          activeOutputFormat: "pdf",
          outputArtifactId: artifact.artifactId,
          output: captureOutputFromArtifact(artifact),
          exportProgress: {
            completedPages,
            totalPages: completedPages,
          },
        },
        {
          ...(completionEvidence === undefined
            ? {}
            : { pdfCompletionEvidence: completionEvidence }),
        },
      );
    } catch (error) {
      const latest = await this.jobs.get(job.id);
      if (latest?.state !== "exporting" || this.cancelledJobs.has(job.id)) return;
      const normalized = normalizeError(error, {
        code: "E_EXPORT_FAILED",
        stage: "export",
        userMessageKey: "errors.exportFailed",
        retryable: true,
        fallbackAllowed: false,
        safeContext: { jobId: job.id.slice(0, 24) },
      });
      const resumable =
        normalized.retryable &&
        (normalized.code === "E_STORAGE_QUOTA" ||
          normalized.code === "E_STORAGE_WRITE" ||
          normalized.code === "E_OFFSCREEN_UNAVAILABLE");
      if (resumable) {
        await this.pdfDocuments?.recordPause?.(job.id, normalized).catch(() => undefined);
        await this.jobs.transition(job.id, "paused", {
          activeOutputFormat: "pdf",
          error: normalized,
        });
        return;
      }
      await this.pdfDocuments?.recordFailure(job.id, normalized).catch(() => undefined);
      await this.jobs.transition(job.id, "failed", {
        activeOutputFormat: "pdf",
        error: normalized,
      });
    }
  }
}
