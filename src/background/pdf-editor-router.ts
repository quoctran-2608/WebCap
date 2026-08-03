import { OffscreenService } from "@background/offscreen-service";
import { PdfEditorService } from "@background/pdf-editor-service";
import { PdfExportService } from "@background/pdf-export-service";
import type {
  CreatePersistentJobOptions,
  JobCleanupReport,
  PersistentJobCoordinatorPort,
} from "@background/job-coordinator";
import {
  transitionJob,
  updateJob,
  type JobInvariantContext,
  type JobTransitionPatch,
} from "@background/job-state-machine";
import type { CaptureJob, JobState } from "@shared/contracts/domain";
import { summarizeJob } from "@shared/contracts/job";
import {
  createPdfEditorErrorMessage,
  createPdfEditorResponseMessage,
  isPdfEditorMessageType,
  parsePdfEditorRequest,
  type PdfEditorErrorMessage,
  type PdfEditorResponseMessage,
} from "@shared/contracts/pdf-editor";
import { isPdfEditorExportStartMessage } from "@shared/contracts/pdf-editor-export";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";
import { IndexedDbJobRepository, type JobRepositoryPort } from "@storage/job-repository";
import {
  JobSessionRepository,
  type JobSessionRepositoryPort,
} from "@storage/job-session-repository";
import { PdfEditManifestRepository } from "@storage/pdf-edit-manifest-repository";
import { IndexedDbTileRepository } from "@storage/tile-repository";

export type PdfEditorRouterResponse = PdfEditorResponseMessage | PdfEditorErrorMessage;

export interface PdfEditorRouterDependencies {
  editor: Pick<PdfEditorService, "get" | "update">;
  exporter: Pick<PdfExportService, "start" | "cancel">;
  now: () => Date;
}

class PdfEditorJobCoordinator implements PersistentJobCoordinatorPort {
  constructor(
    private readonly jobs: JobRepositoryPort,
    private readonly sessions: JobSessionRepositoryPort,
    private readonly now: () => Date,
  ) {}

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  create(options: CreatePersistentJobOptions): Promise<CaptureJob> {
    void options;
    return Promise.reject(new Error("PDF editor cannot create capture jobs."));
  }

  get(jobId: string): Promise<CaptureJob | undefined> {
    return this.jobs.get(jobId);
  }

  async update(
    jobId: string,
    patch: JobTransitionPatch,
    context: JobInvariantContext = {},
  ): Promise<CaptureJob> {
    const job = await this.requireJob(jobId);
    const result = updateJob(job, this.now().toISOString(), patch, context);
    if (!result.ok) throw createWebCapRuntimeError(result.error);
    await this.jobs.save(result.value, job.stateRevision);
    await this.sessions.saveSummary(summarizeJob(result.value));
    return result.value;
  }

  async transition(
    jobId: string,
    nextState: JobState,
    patch: JobTransitionPatch = {},
    context: JobInvariantContext = {},
  ): Promise<CaptureJob> {
    const job = await this.requireJob(jobId);
    const result = transitionJob(job, nextState, this.now().toISOString(), patch, context);
    if (!result.ok) throw createWebCapRuntimeError(result.error);
    await this.jobs.save(result.value, job.stateRevision);
    await this.sessions.saveSummary(summarizeJob(result.value));
    return result.value;
  }

  cancel(jobId: string, reason?: string): Promise<CaptureJob> {
    void jobId;
    void reason;
    return Promise.reject(new Error("PDF editor uses export-only cancellation."));
  }

  cleanupExpired(): Promise<JobCleanupReport> {
    return Promise.reject(new Error("PDF editor cannot run capture cleanup."));
  }

  private async requireJob(jobId: string): Promise<CaptureJob> {
    const job = await this.jobs.get(jobId);
    if (job !== undefined) return job;
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_STORAGE_READ",
        stage: "storage",
        message: "The requested PDF editor job does not exist.",
        userMessageKey: "errors.jobNotFound",
        retryable: false,
        fallbackAllowed: false,
        causeCode: "PdfEditorJobMissing",
        safeContext: { jobId: jobId.slice(0, 24) },
      }),
    );
  }
}

let sharedDependencies: PdfEditorRouterDependencies | undefined;

function defaultDependencies(): PdfEditorRouterDependencies {
  if (sharedDependencies !== undefined) return sharedDependencies;
  const jobs = new IndexedDbJobRepository();
  const manifests = new PdfEditManifestRepository();
  const coordinator = new PdfEditorJobCoordinator(
    jobs,
    new JobSessionRepository(),
    () => new Date(),
  );
  sharedDependencies = {
    editor: new PdfEditorService({ jobs: coordinator, manifests }),
    exporter: new PdfExportService({
      jobs: coordinator,
      tiles: new IndexedDbTileRepository(),
      offscreen: new OffscreenService(),
      manifests,
    }),
    now: () => new Date(),
  };
  void new IndexedDbArtifactRepository()
    .deleteExpired(new Date().toISOString())
    .catch(() => undefined);
  return sharedDependencies;
}

function requestIdFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("requestId" in value)) return undefined;
  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}

function targetsPdfEditorBackground(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "target" in value &&
    (value as { target?: unknown }).target === "pdf-editor-background"
  );
}

export async function routePdfEditorMessage(
  message: unknown,
  dependencies: PdfEditorRouterDependencies,
): Promise<PdfEditorRouterResponse | undefined> {
  if (!targetsPdfEditorBackground(message)) return undefined;
  const requestId = requestIdFrom(message);
  if (requestId === undefined) return undefined;

  try {
    if (isPdfEditorExportStartMessage(message)) {
      await dependencies.exporter.start(message.payload.jobId);
      return createPdfEditorResponseMessage({
        requestId,
        snapshot: await dependencies.editor.get(message.payload.jobId),
        sentAt: dependencies.now().toISOString(),
      });
    }

    const parsed = parsePdfEditorRequest(message);
    if (!parsed.ok) {
      return createPdfEditorErrorMessage({
        requestId,
        error: parsed.error,
        sentAt: dependencies.now().toISOString(),
      });
    }

    const snapshot =
      parsed.value.type === "PDF_EDITOR_GET"
        ? await dependencies.editor.get(parsed.value.payload.jobId)
        : parsed.value.type === "PDF_EDITOR_UPDATE"
          ? await dependencies.editor.update(
              parsed.value.payload.jobId,
              parsed.value.payload.expectedRevision,
              parsed.value.payload.action,
            )
          : (await dependencies.exporter.cancel(parsed.value.payload.jobId),
            await dependencies.editor.get(parsed.value.payload.jobId));
    return createPdfEditorResponseMessage({
      requestId,
      snapshot,
      sentAt: dependencies.now().toISOString(),
    });
  } catch (error) {
    return createPdfEditorErrorMessage({
      requestId,
      error: normalizeError(error, {
        code: "E_EXPORT_FAILED",
        stage: "export",
        userMessageKey: "errors.pdfEditor",
        retryable: true,
        fallbackAllowed: false,
      }),
      sentAt: dependencies.now().toISOString(),
    });
  }
}

export function registerPdfEditorRouter(): void {
  const dependencies = defaultDependencies();
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (
        !targetsPdfEditorBackground(message) ||
        (!isPdfEditorMessageType(message) && !isPdfEditorExportStartMessage(message))
      ) {
        return false;
      }
      void routePdfEditorMessage(message, dependencies).then((response) => {
        if (response !== undefined) sendResponse(response);
      });
      return true;
    },
  );
}
