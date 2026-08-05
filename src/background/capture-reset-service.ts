import type { CaptureResetReport, CaptureResetRequest } from "@shared/contracts/capture-reset";
import type { CaptureJob } from "@shared/contracts/domain";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { JobArtifactCleanupPort } from "@storage/job-artifact-cleanup-repository";
import type { VisibleSessionRepositoryPort } from "@storage/visible-session-repository";

import type {
  CaptureOwnedDataCleanupPort,
  CaptureOwnedDataCleanupReport,
} from "./capture-data-cleanup-service";
import { emptyResetReport } from "./capture-data-cleanup-service";
import type { PersistentJobCoordinatorPort } from "./job-coordinator";
import type { VisibleCaptureCoordinatorPort } from "./visible-capture-coordinator";

export interface ResettableCaptureCoordinatorPort {
  cancel(
    jobId: string,
    reason?: string,
    disposition?: "discard" | "keep-partial",
  ): Promise<CaptureJob>;
  waitForIdle?(jobId: string): Promise<void>;
}

export interface ResettablePdfExportPort {
  cancel(jobId: string): Promise<CaptureJob>;
  waitForIdle?(jobId: string): Promise<void>;
}

export interface ResettableSelectorPort {
  cancel(tabId: number, jobId: string): Promise<boolean>;
}

export interface ResettableImageExportPort {
  cancelBySourceArtifactId(sourceArtifactId: string): Promise<void>;
}

export interface CaptureResetServiceOptions {
  jobs: PersistentJobCoordinatorPort;
  cleanup: CaptureOwnedDataCleanupPort;
  captures?: ResettableCaptureCoordinatorPort;
  scrollAreaCaptures?: ResettableCaptureCoordinatorPort;
  pdfExports?: ResettablePdfExportPort;
  regionSelections?: ResettableSelectorPort;
  elementSelections?: ResettableSelectorPort;
  visibleSessions: VisibleSessionRepositoryPort;
  visibleCapture: VisibleCaptureCoordinatorPort;
  imageExport: ResettableImageExportPort;
  artifacts: Pick<ArtifactRepositoryPort, "delete">;
  artifactsByJob: JobArtifactCleanupPort;
}

const ACTIVE_JOB_STATES = new Set<CaptureJob["state"]>([
  "created",
  "preparing",
  "capturing",
  "processing",
  "exporting",
  "cancelling",
]);

function mergeWarnings(warnings: Array<WebCapErrorData | undefined>): WebCapErrorData | undefined {
  const present = warnings.filter((warning): warning is WebCapErrorData => warning !== undefined);
  if (present.length === 0) return undefined;
  return createWebCapError({
    code: "E_CLEANUP_PARTIAL",
    stage: "cleanup",
    message: "The capture was reset, but some page or local cleanup steps need attention.",
    userMessageKey: "errors.cleanupPartial",
    retryable: true,
    fallbackAllowed: false,
    causeCode: "CaptureResetPartial",
    safeContext: {
      warnings: present
        .map((warning) => warning.causeCode ?? warning.code)
        .join(",")
        .slice(0, 180),
    },
  });
}

function operationWarning(error: unknown, operation: string, jobId?: string): WebCapErrorData {
  return createWebCapError({
    code: "E_CLEANUP_PARTIAL",
    stage: "cleanup",
    message: "A capture reset cleanup operation did not complete normally.",
    userMessageKey: "errors.cleanupPartial",
    retryable: true,
    fallbackAllowed: false,
    causeCode: error instanceof Error ? error.name : "CaptureResetOperationFailure",
    safeContext: {
      operation,
      ...(jobId === undefined ? {} : { jobId: jobId.slice(0, 24) }),
    },
  });
}

function applyCleanupReport(
  report: CaptureResetReport,
  cleanup: CaptureOwnedDataCleanupReport,
): CaptureResetReport {
  return {
    ...report,
    deletedJobs: report.deletedJobs + cleanup.deletedJobs,
    deletedTiles: report.deletedTiles + cleanup.deletedTiles,
    deletedArtifacts: report.deletedArtifacts + cleanup.deletedArtifacts,
    deletedManifests: report.deletedManifests + cleanup.deletedManifests,
    clearedSessions: report.clearedSessions + cleanup.clearedSessions,
    warning: mergeWarnings([report.warning, cleanup.warning]),
  };
}

function mergeReports(base: CaptureResetReport, next: CaptureResetReport): CaptureResetReport {
  return {
    ...base,
    cancellationAttempted: base.cancellationAttempted || next.cancellationAttempted,
    cancellationCompleted: base.cancellationCompleted && next.cancellationCompleted,
    deletedJobs: base.deletedJobs + next.deletedJobs,
    deletedTiles: base.deletedTiles + next.deletedTiles,
    deletedArtifacts: base.deletedArtifacts + next.deletedArtifacts,
    deletedManifests: base.deletedManifests + next.deletedManifests,
    clearedSessions: base.clearedSessions + next.clearedSessions,
    warning: mergeWarnings([base.warning, next.warning]),
  };
}

export class CaptureResetService {
  constructor(private readonly options: CaptureResetServiceOptions) {}

  async reset(request: CaptureResetRequest): Promise<CaptureResetReport> {
    switch (request.payload.scope) {
      case "visible-session":
        return this.resetVisibleSession();
      case "job":
        return this.resetJob(request.payload.jobId);
      case "tab":
        return this.resetTab(request.payload.tabId);
    }
  }

  private async resetJob(jobId: string): Promise<CaptureResetReport> {
    const job = await this.options.jobs.get(jobId);
    let report = emptyResetReport("job", {
      jobId,
      ...(job === undefined ? {} : { tabId: job.tabId }),
    });
    const warnings: WebCapErrorData[] = [];

    if (job !== undefined) {
      let selectorCancellationAttempted = false;
      try {
        if (job.mode === "region" && this.options.regionSelections !== undefined) {
          selectorCancellationAttempted = true;
          await this.options.regionSelections.cancel(job.tabId, job.id);
        } else if (
          (job.mode === "element" || job.mode === "scroll-area") &&
          this.options.elementSelections !== undefined
        ) {
          selectorCancellationAttempted = true;
          await this.options.elementSelections.cancel(job.tabId, job.id);
        }
      } catch (error) {
        warnings.push(operationWarning(error, "selector-cancel", job.id));
      }

      const active = ACTIVE_JOB_STATES.has(job.state);
      report = {
        ...report,
        cancellationAttempted: selectorCancellationAttempted || active,
        cancellationCompleted: true,
      };
      if (active) {
        try {
          if (job.state === "exporting" && this.options.pdfExports !== undefined) {
            await this.options.pdfExports.cancel(job.id);
            await this.options.pdfExports.waitForIdle?.(job.id);
          } else {
            const coordinator =
              job.mode === "scroll-area" ? this.options.scrollAreaCaptures : this.options.captures;
            if (coordinator !== undefined) {
              await coordinator.cancel(job.id, "capture reset", "discard");
              await coordinator.waitForIdle?.(job.id);
            } else {
              await this.options.jobs.cancel(job.id, "capture reset");
            }
          }
        } catch (error) {
          report = { ...report, cancellationCompleted: false };
          warnings.push(operationWarning(error, "job-cancel", job.id));
        }
      }
    }

    const cleanup = await this.options.cleanup.cleanupJob(jobId, job?.tabId);
    report = applyCleanupReport(report, cleanup);
    return {
      ...report,
      warning: mergeWarnings([report.warning, ...warnings]),
    };
  }

  private async resetVisibleSession(): Promise<CaptureResetReport> {
    const session = await this.options.visibleSessions.load();
    let report = emptyResetReport("visible-session");
    if (session === undefined) return report;

    const warnings: WebCapErrorData[] = [];
    const captureActive = session.status === "capturing";
    const exportActive = session.status === "captured" || session.status === "processing";
    report = {
      ...report,
      cancellationAttempted: captureActive || exportActive,
      cancellationCompleted: true,
    };

    if (captureActive) {
      try {
        this.options.visibleCapture.cancel(session.captureRequestId);
        await this.options.visibleCapture.waitForIdle(session.captureRequestId);
      } catch (error) {
        report = { ...report, cancellationCompleted: false };
        warnings.push(operationWarning(error, "visible-capture-cancel"));
      }
    }

    const sourceArtifactId = session.source?.captureId;
    if (sourceArtifactId !== undefined) {
      try {
        await this.options.imageExport.cancelBySourceArtifactId(sourceArtifactId);
      } catch (error) {
        report = { ...report, cancellationCompleted: false };
        warnings.push(operationWarning(error, "visible-export-cancel"));
      }
      this.options.visibleCapture.releaseCapture(sourceArtifactId);
      try {
        report = {
          ...report,
          deletedArtifacts:
            report.deletedArtifacts +
            (await this.options.artifactsByJob.deleteByJob(sourceArtifactId)),
        };
      } catch (error) {
        warnings.push(operationWarning(error, "visible-artifact-cleanup"));
      }
    } else if (session.artifact !== undefined) {
      try {
        report = {
          ...report,
          deletedArtifacts:
            report.deletedArtifacts +
            ((await this.options.artifacts.delete(session.artifact.artifactId)) ? 1 : 0),
        };
      } catch (error) {
        warnings.push(operationWarning(error, "visible-output-cleanup"));
      }
    }

    try {
      await this.options.visibleSessions.clear();
      report = { ...report, clearedSessions: 1 };
    } catch (error) {
      warnings.push(operationWarning(error, "visible-session-clear"));
    }

    return {
      ...report,
      warning: mergeWarnings([report.warning, ...warnings]),
    };
  }

  private async resetTab(tabId: number): Promise<CaptureResetReport> {
    let report = emptyResetReport("tab", { tabId });
    const job = await this.options.jobs.getActiveForTab?.(tabId);
    if (job !== undefined) {
      report = mergeReports(report, await this.resetJob(job.id));
    }
    const visible = await this.options.visibleSessions.load();
    if (visible?.source?.tabId === tabId) {
      report = mergeReports(report, await this.resetVisibleSession());
    }
    return { ...report, scope: "tab", tabId, jobId: undefined };
  }
}
