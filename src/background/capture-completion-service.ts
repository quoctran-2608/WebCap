import type { ArtifactRecord } from "@shared/contracts/artifact";
import type {
  CaptureJob,
  CaptureSettings,
  ImageFormat,
  OutputFormat,
} from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { JobArtifactLookupPort } from "@storage/artifact-repository";

import { completionPolicyForJob } from "./capture-completion-policy";
import { captureOutputFromArtifact } from "./capture-output";
import type { PersistentJobCoordinatorPort } from "./job-coordinator";
import {
  isDedicatedViewerPdfJob,
  type PdfCaptureOrchestratorPort,
} from "./pdf-capture-orchestrator";
import { getPdfCaptureOrchestrator } from "./pdf-capture-runtime";

export interface CompletionPdfExportPort {
  start(jobId: string, settings?: CaptureSettings["pdf"]): Promise<CaptureJob>;
  cancel(jobId: string): Promise<CaptureJob>;
  waitForIdle(jobId: string): Promise<void>;
}

export interface CompletionImageExportPort {
  start(jobId: string, format: ImageFormat, quality?: number): Promise<CaptureJob>;
  cancel(jobId: string): Promise<CaptureJob>;
  waitForIdle(jobId: string): Promise<void>;
}

export interface CaptureOutputStartOptions {
  format?: OutputFormat;
  pdfSettings?: CaptureSettings["pdf"];
  allowPartial?: boolean;
  automatic?: boolean;
}

export interface CaptureCompletionServiceOptions {
  jobs: PersistentJobCoordinatorPort;
  pdf: CompletionPdfExportPort;
  images: CompletionImageExportPort;
  artifacts: JobArtifactLookupPort;
  pdfDocuments?: PdfCaptureOrchestratorPort;
}

function jobMissingError(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The capture job required for output no longer exists.",
      userMessageKey: "errors.jobNotFound",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "CaptureOutputJobMissing",
      safeContext: { jobId: jobId.slice(0, 24) },
    }),
  );
}

function partialConfirmationError(job: CaptureJob): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message: "Partial capture output requires explicit user confirmation.",
      userMessageKey: "errors.partialOutputConfirmation",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "PartialOutputConfirmationRequired",
      safeContext: {
        jobId: job.id.slice(0, 24),
        reason: job.partialCapture?.reason ?? "unknown",
      },
    }),
  );
}

function completionEvidenceError(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message: "Dedicated PDF completion evidence is unavailable.",
      userMessageKey: "errors.exportFailed",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "PdfDocumentCompletionEvidenceUnavailable",
      safeContext: { jobId: jobId.slice(0, 24) },
    }),
  );
}

function newestOutput(records: ArtifactRecord[]): ArtifactRecord | undefined {
  return records
    .filter((record) => record.role === "output")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export class CaptureCompletionService {
  private readonly pdfDocuments: PdfCaptureOrchestratorPort | undefined;

  constructor(private readonly options: CaptureCompletionServiceOptions) {
    this.pdfDocuments = options.pdfDocuments ?? getPdfCaptureOrchestrator();
  }

  async startAuto(jobId: string): Promise<CaptureJob> {
    const job = await this.requireJob(jobId);
    const policy = completionPolicyForJob(job);
    if (!policy.autoExport) return job;
    if (job.partialCapture !== undefined && job.partialCapture.reason !== "user-stop") return job;
    return this.start(jobId, { format: policy.primaryOutput, automatic: true });
  }

  async start(jobId: string, options: CaptureOutputStartOptions = {}): Promise<CaptureJob> {
    let job = await this.requireJob(jobId);
    if (job.state === "completed") return job;

    const reconciled = await this.reconcileExistingOutput(job);
    if (reconciled !== undefined) return reconciled;
    job = await this.requireJob(jobId);

    const automatic = options.automatic ?? false;
    if (automatic && job.state === "failed" && job.error?.causeCode !== "ServiceWorkerRestart") {
      return job;
    }
    if (
      job.partialCapture !== undefined &&
      job.partialCapture.reason !== "user-stop" &&
      options.allowPartial !== true
    ) {
      throw partialConfirmationError(job);
    }

    const format = options.format ?? completionPolicyForJob(job).primaryOutput;
    if (format === "pdf") {
      return this.options.pdf.start(jobId, options.pdfSettings);
    }
    return this.options.images.start(jobId, format, job.settings.imageQuality);
  }

  async recover(jobId: string): Promise<CaptureJob> {
    const job = await this.requireJob(jobId);
    const reconciled = await this.reconcileExistingOutput(job);
    if (reconciled !== undefined) return reconciled;
    if (job.state === "ready") return this.startAuto(job.id);
    if (job.state === "failed" && job.error?.causeCode === "ServiceWorkerRestart") {
      return this.startAuto(job.id);
    }
    return job;
  }

  async recoverAll(): Promise<CaptureJob[]> {
    const jobs = (await this.options.jobs.listActive?.()) ?? [];
    const candidates = jobs.filter((job) => job.state === "ready" || job.state === "failed");
    const settled = await Promise.allSettled(candidates.map((job) => this.recover(job.id)));
    return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  }

  async cancel(jobId: string): Promise<CaptureJob> {
    const job = await this.requireJob(jobId);
    const format = job.activeOutputFormat ?? completionPolicyForJob(job).primaryOutput;
    return format === "pdf" ? this.options.pdf.cancel(jobId) : this.options.images.cancel(jobId);
  }

  async waitForIdle(jobId: string): Promise<void> {
    await Promise.all([
      this.options.pdf.waitForIdle(jobId),
      this.options.images.waitForIdle(jobId),
    ]);
  }

  private async requireJob(jobId: string): Promise<CaptureJob> {
    const job = await this.options.jobs.get(jobId);
    if (job === undefined) throw jobMissingError(jobId);
    return job;
  }

  private async reconcileExistingOutput(job: CaptureJob): Promise<CaptureJob | undefined> {
    if (!["ready", "failed", "exporting"].includes(job.state)) return undefined;
    const artifact = newestOutput(await this.options.artifacts.listByJob(job.id));
    if (artifact === undefined) return undefined;
    const totalPages = artifact.format === "pdf" ? (artifact.pageCount ?? 1) : 1;
    const dedicated =
      artifact.format === "pdf" &&
      isDedicatedViewerPdfJob(job) &&
      job.partialCapture === undefined;
    const evidence = dedicated
      ? await this.pdfDocuments?.completeViewerOutput(job, totalPages)
      : undefined;
    if (dedicated && evidence === undefined) throw completionEvidenceError(job.id);

    let exporting = job;
    if (job.state !== "exporting") {
      exporting = await this.options.jobs.transition(
        job.id,
        "exporting",
        {
          activeOutputFormat: artifact.format,
          exportProgress: { completedPages: 0, totalPages },
        },
        { sourceArtifactExists: true },
      );
    }
    return this.options.jobs.transition(
      exporting.id,
      "completed",
      {
        activeOutputFormat: artifact.format,
        outputArtifactId: artifact.artifactId,
        output: captureOutputFromArtifact(artifact),
        exportProgress: { completedPages: totalPages, totalPages },
      },
      {
        ...(evidence?.verified === true ? { pdfCompletionVerified: true } : {}),
      },
    );
  }
}
