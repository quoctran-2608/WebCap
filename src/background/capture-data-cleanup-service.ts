import type { CaptureResetReport } from "@shared/contracts/capture-reset";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import type { JobArtifactCleanupPort } from "@storage/job-artifact-cleanup-repository";
import type { JobRepositoryPort } from "@storage/job-repository";
import type { JobSessionRepositoryPort } from "@storage/job-session-repository";
import type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

export interface CaptureOwnedDataCleanupReport {
  deletedJobs: number;
  deletedTiles: number;
  deletedArtifacts: number;
  deletedManifests: number;
  clearedSessions: number;
  warning?: WebCapErrorData;
}

export interface CaptureOwnedDataCleanupPort {
  cleanupJob(jobId: string, tabId?: number): Promise<CaptureOwnedDataCleanupReport>;
}

export interface CaptureOwnedDataCleanupServiceOptions {
  jobs: Pick<JobRepositoryPort, "delete">;
  sessions: Pick<JobSessionRepositoryPort, "getSummary" | "getTabLock" | "deleteJob">;
  tiles: Pick<TileRepositoryPort, "deleteByJob">;
  artifacts: JobArtifactCleanupPort;
  manifests: Pick<PdfEditManifestRepositoryPort, "load" | "delete">;
}

function cleanupWarning(jobId: string, failedOperations: string[]): WebCapErrorData | undefined {
  if (failedOperations.length === 0) return undefined;
  return createWebCapError({
    code: "E_CLEANUP_PARTIAL",
    stage: "cleanup",
    message: "WebCap could not remove every local record owned by the capture.",
    userMessageKey: "errors.cleanupPartial",
    retryable: true,
    fallbackAllowed: false,
    causeCode: "CaptureOwnedDataCleanupPartial",
    safeContext: {
      jobId: jobId.slice(0, 24),
      failedOperations: failedOperations.join(",").slice(0, 180),
    },
  });
}

export class CaptureOwnedDataCleanupService implements CaptureOwnedDataCleanupPort {
  constructor(private readonly options: CaptureOwnedDataCleanupServiceOptions) {}

  async cleanupJob(jobId: string, tabId?: number): Promise<CaptureOwnedDataCleanupReport> {
    const report: CaptureOwnedDataCleanupReport = {
      deletedJobs: 0,
      deletedTiles: 0,
      deletedArtifacts: 0,
      deletedManifests: 0,
      clearedSessions: 0,
    };
    const failedOperations: string[] = [];

    try {
      const manifest = await this.options.manifests.load(jobId);
      await this.options.manifests.delete(jobId);
      report.deletedManifests = manifest === undefined ? 0 : 1;
    } catch {
      failedOperations.push("manifest");
    }

    try {
      report.deletedArtifacts = await this.options.artifacts.deleteByJob(jobId);
    } catch {
      failedOperations.push("artifacts");
    }

    try {
      report.deletedTiles = await this.options.tiles.deleteByJob(jobId);
    } catch {
      failedOperations.push("tiles");
    }

    try {
      report.deletedJobs = (await this.options.jobs.delete(jobId)) ? 1 : 0;
    } catch {
      failedOperations.push("job");
    }

    try {
      const [summary, lock] = await Promise.all([
        this.options.sessions.getSummary(jobId),
        tabId === undefined ? Promise.resolve(undefined) : this.options.sessions.getTabLock(tabId),
      ]);
      await this.options.sessions.deleteJob(jobId);
      report.clearedSessions = summary !== undefined || lock?.jobId === jobId ? 1 : 0;
    } catch {
      failedOperations.push("session");
    }

    const warning = cleanupWarning(jobId, failedOperations);
    return warning === undefined ? report : { ...report, warning };
  }
}

export function emptyResetReport(
  scope: CaptureResetReport["scope"],
  identity: { jobId?: string; tabId?: number } = {},
): CaptureResetReport {
  return {
    schemaVersion: 1,
    scope,
    ...(identity.jobId === undefined ? {} : { jobId: identity.jobId }),
    ...(identity.tabId === undefined ? {} : { tabId: identity.tabId }),
    cancellationAttempted: false,
    cancellationCompleted: true,
    deletedJobs: 0,
    deletedTiles: 0,
    deletedArtifacts: 0,
    deletedManifests: 0,
    clearedSessions: 0,
  };
}
