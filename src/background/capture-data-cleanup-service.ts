import type { CaptureResetReport } from "@shared/contracts/capture-reset";
import type { JobArtifactLookupPort } from "@storage/artifact-repository";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import type { JobArtifactCleanupPort } from "@storage/job-artifact-cleanup-repository";
import type { JobRepositoryPort } from "@storage/job-repository";
import type { JobSessionRepositoryPort } from "@storage/job-session-repository";
import type { PdfDocumentManifestRepositoryPort } from "@storage/pdf-document-manifest-repository";
import type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";
import type { PdfOutputSpoolPort } from "@storage/pdf-output-spool";
import type { PdfWriterCheckpointRepositoryPort } from "@storage/pdf-writer-checkpoint-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

import { getPdfDocumentManifestRepository } from "./pdf-capture-runtime";

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
  artifactLookup?: Pick<JobArtifactLookupPort, "listByJob">;
  pdfSpool?: Pick<PdfOutputSpoolPort, "delete" | "deleteOutputFamily">;
  pdfWriterCheckpoints?: Pick<PdfWriterCheckpointRepositoryPort, "get" | "delete">;
  manifests: Pick<PdfEditManifestRepositoryPort, "load" | "delete">;
  pdfDocuments?: Pick<PdfDocumentManifestRepositoryPort, "get" | "delete">;
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
  private readonly pdfDocuments:
    Pick<PdfDocumentManifestRepositoryPort, "get" | "delete"> | undefined;

  constructor(private readonly options: CaptureOwnedDataCleanupServiceOptions) {
    this.pdfDocuments = options.pdfDocuments ?? getPdfDocumentManifestRepository();
  }

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

    if (this.pdfDocuments !== undefined) {
      try {
        const document = await this.pdfDocuments.get(jobId);
        await this.pdfDocuments.delete(jobId);
        if (document !== undefined) report.deletedManifests += 1;
      } catch {
        failedOperations.push("pdf-document");
      }
    }

    let writerCheckpoint:
      Awaited<ReturnType<NonNullable<typeof this.options.pdfWriterCheckpoints>["get"]>> | undefined;
    try {
      writerCheckpoint = await this.options.pdfWriterCheckpoints?.get(jobId);
    } catch {
      failedOperations.push("pdf-writer-checkpoint-read");
    }

    if (this.options.pdfSpool !== undefined) {
      const references = new Set<string>();
      try {
        const records = await this.options.artifactLookup?.listByJob(jobId);
        for (const record of records ?? []) {
          if (record.opfsReference !== undefined) references.add(record.opfsReference);
        }
      } catch {
        failedOperations.push("artifact-opfs-lookup");
      }
      if (writerCheckpoint !== undefined) references.add(writerCheckpoint.spoolReference);
      for (const reference of references) {
        try {
          await this.options.pdfSpool.delete(reference);
        } catch {
          failedOperations.push("pdf-spool");
        }
      }
      if (
        writerCheckpoint !== undefined &&
        this.options.pdfSpool.deleteOutputFamily !== undefined
      ) {
        try {
          await this.options.pdfSpool.deleteOutputFamily(
            writerCheckpoint.outputArtifactId,
            writerCheckpoint.totalPages,
          );
        } catch {
          failedOperations.push("pdf-spool-family");
        }
      }
    }

    if (this.options.pdfWriterCheckpoints !== undefined) {
      try {
        await this.options.pdfWriterCheckpoints.delete(jobId);
      } catch {
        failedOperations.push("pdf-writer-checkpoint");
      }
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
