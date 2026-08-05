import { planPdfDocument } from "@offscreen/pdf-layout";
import type { CaptureJob } from "@shared/contracts/domain";
import {
  type PdfEditManifest,
  type PdfEditorPage,
  type PdfEditorSnapshot,
  type PdfEditorUpdateAction,
} from "@shared/contracts/pdf-editor";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";

import type { PersistentJobCoordinatorPort } from "./job-coordinator";

export interface PdfEditorServiceOptions {
  jobs: PersistentJobCoordinatorPort;
  manifests: PdfEditManifestRepositoryPort;
  artifacts?: Pick<ArtifactRepositoryPort, "delete">;
  now?: () => Date;
}

function editorError(message: string, causeCode: string, jobId: string, retryable = false): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message,
      userMessageKey: "errors.pdfEditor",
      retryable,
      fallbackAllowed: false,
      causeCode,
      safeContext: { jobId: jobId.slice(0, 24) },
    }),
  );
}

function assertEditableSource(job: CaptureJob | undefined, jobId: string): CaptureJob {
  if (job === undefined) {
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_STORAGE_READ",
        stage: "storage",
        message: "The PDF editor source job does not exist.",
        userMessageKey: "errors.jobNotFound",
        retryable: false,
        fallbackAllowed: false,
        causeCode: "PdfEditorJobMissing",
        safeContext: { jobId: jobId.slice(0, 24) },
      }),
    );
  }
  if (
    !["full-page", "region", "element"].includes(job.mode) ||
    job.targetRect === undefined ||
    job.tilePlan.length === 0 ||
    job.completedTiles !== job.totalTiles ||
    job.tilePlan.some((tile) => tile.status !== "stored")
  ) {
    throw editorError(
      "The capture job does not contain a complete tile set for PDF editing.",
      "PdfEditorSourceNotReady",
      jobId,
      true,
    );
  }
  if (!["ready", "exporting", "completed", "failed"].includes(job.state)) {
    throw editorError(
      "The capture job is not in an editable PDF state.",
      "PdfEditorStateInvalid",
      jobId,
      true,
    );
  }
  return job;
}

function createPages(job: CaptureJob, settings: CaptureJob["settings"]["pdf"]): PdfEditorPage[] {
  const targetRect = job.targetRect;
  if (targetRect === undefined) {
    throw editorError(
      "The PDF editor target rectangle is unavailable.",
      "PdfEditorTargetMissing",
      job.id,
    );
  }
  return planPdfDocument(targetRect, settings).pages.map((page) => ({
    id: `page-${page.index + 1}`,
    originalIndex: page.index,
    sourceRectCss: page.sourceRectCss,
    pageWidthPt: page.pageWidthPt,
    pageHeightPt: page.pageHeightPt,
    imageRectPt: page.imageRectPt,
  }));
}

export class PdfEditorService {
  private readonly jobs: PersistentJobCoordinatorPort;
  private readonly manifests: PdfEditManifestRepositoryPort;
  private readonly artifacts: Pick<ArtifactRepositoryPort, "delete"> | undefined;
  private readonly now: () => Date;
  private readonly operations = new Map<string, Promise<PdfEditorSnapshot>>();

  constructor(options: PdfEditorServiceOptions) {
    this.jobs = options.jobs;
    this.manifests = options.manifests;
    this.artifacts = options.artifacts;
    this.now = options.now ?? (() => new Date());
  }

  async get(jobId: string): Promise<PdfEditorSnapshot> {
    const job = assertEditableSource(await this.jobs.get(jobId), jobId);
    const manifest = await this.ensureManifest(job);
    return this.snapshot(job, manifest);
  }

  update(
    jobId: string,
    expectedRevision: number,
    action: PdfEditorUpdateAction,
  ): Promise<PdfEditorSnapshot> {
    const previous = this.operations.get(jobId) ?? Promise.resolve(undefined);
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const job = assertEditableSource(await this.jobs.get(jobId), jobId);
        if (job.state === "exporting") {
          throw editorError(
            "PDF pages and settings cannot change while export is running.",
            "PdfEditorExportInProgress",
            jobId,
            true,
          );
        }
        const current = await this.ensureManifest(job);
        if (current.revision !== expectedRevision) {
          throw editorError(
            "The PDF edit manifest changed in another editor tab.",
            "PdfEditRevisionConflict",
            jobId,
            true,
          );
        }
        const nowIso = this.now().toISOString();
        let next: PdfEditManifest;
        if (action.kind === "settings") {
          next = {
            ...current,
            revision: current.revision + 1,
            settings: action.settings,
            pages: createPages(job, action.settings),
            updatedAt: nowIso,
          };
        } else {
          const unique = new Set(action.pageIds);
          if (unique.size !== action.pageIds.length) {
            throw editorError(
              "PDF page order contains duplicate page identifiers.",
              "PdfEditDuplicatePage",
              jobId,
            );
          }
          const byId = new Map(current.pages.map((page) => [page.id, page]));
          const pages = action.pageIds.map((pageId) => byId.get(pageId));
          if (pages.some((page) => page === undefined)) {
            throw editorError(
              "PDF page order references a page outside the current manifest.",
              "PdfEditPageMissing",
              jobId,
            );
          }
          next = {
            ...current,
            revision: current.revision + 1,
            pages: pages as PdfEditorPage[],
            updatedAt: nowIso,
          };
        }
        await this.manifests.save(next);
        let snapshotJob = job;
        if (job.state === "completed") {
          try {
            snapshotJob = await this.jobs.transition(job.id, "ready", {
              activeOutputFormat: undefined,
              output: undefined,
              outputArtifactId: undefined,
              exportProgress: undefined,
              error: undefined,
            });
          } catch (error) {
            await this.manifests.save(current).catch(() => undefined);
            throw error;
          }
          if (job.outputArtifactId !== undefined) {
            await this.artifacts?.delete(job.outputArtifactId).catch(() => false);
          }
        }
        return this.snapshot(snapshotJob, next);
      })
      .finally(() => {
        if (this.operations.get(jobId) === operation) this.operations.delete(jobId);
      });
    this.operations.set(jobId, operation);
    return operation;
  }

  private async ensureManifest(job: CaptureJob): Promise<PdfEditManifest> {
    const existing = await this.manifests.load(job.id);
    if (existing !== undefined) return existing;
    const nowIso = this.now().toISOString();
    const manifest: PdfEditManifest = {
      schemaVersion: 1,
      jobId: job.id,
      revision: 0,
      settings: job.settings.pdf,
      pages: createPages(job, job.settings.pdf),
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: job.expiresAt,
    };
    await this.manifests.save(manifest);
    return manifest;
  }

  private snapshot(job: CaptureJob, manifest: PdfEditManifest): PdfEditorSnapshot {
    const sourceBytes = job.tilePlan.reduce((total, tile) => total + (tile.byteLength ?? 0), 0);
    const targetHeight = Math.max(1, job.targetRect?.height ?? 1);
    const selectedHeight = manifest.pages.reduce(
      (total, page) => total + page.sourceRectCss.height,
      0,
    );
    const coverageRatio = Math.min(1, selectedHeight / targetHeight);
    const estimatedBytes = Math.max(
      1,
      Math.round(
        sourceBytes * coverageRatio * (0.4 + manifest.settings.jpegQuality * 0.65) +
          manifest.pages.length * 1_500,
      ),
    );
    return {
      job,
      manifest,
      estimate: {
        approximate: true,
        sourceBytes,
        estimatedBytes,
      },
    };
  }
}
