import { describe, expect, it, vi } from "vitest";

import { CaptureOwnedDataCleanupService } from "@background/capture-data-cleanup-service";
import type { JobRepositoryPort } from "@storage/job-repository";
import type { JobSessionRepositoryPort } from "@storage/job-session-repository";
import type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";

function dependencies(options: { failArtifacts?: boolean } = {}) {
  const jobs = {
    delete: vi.fn(() => Promise.resolve(true)),
  } as unknown as JobRepositoryPort;
  const deleteSessionJob = vi.fn(() => Promise.resolve());
  const sessions = {
    getSummary: vi.fn(() =>
      Promise.resolve({ jobId: "job-1", tabId: 7 } as Awaited<
        ReturnType<JobSessionRepositoryPort["getSummary"]>
      >),
    ),
    getTabLock: vi.fn(() =>
      Promise.resolve({ jobId: "job-1" } as Awaited<
        ReturnType<JobSessionRepositoryPort["getTabLock"]>
      >),
    ),
    deleteJob: deleteSessionJob,
  } as unknown as JobSessionRepositoryPort;
  const deleteManifest = vi.fn(() => Promise.resolve());
  const manifests = {
    load: vi.fn(() => Promise.resolve({ jobId: "job-1" })),
    delete: deleteManifest,
  } as unknown as PdfEditManifestRepositoryPort;
  const tiles = { deleteByJob: vi.fn(() => Promise.resolve(5)) };
  const artifacts = {
    deleteByJob: vi.fn(() =>
      options.failArtifacts ? Promise.reject(new Error("artifact failure")) : Promise.resolve(3),
    ),
  };
  return { jobs, sessions, manifests, tiles, artifacts, deleteSessionJob, deleteManifest };
}

describe("CaptureOwnedDataCleanupService", () => {
  it("deletes every owned record class and reports exact counts", async () => {
    const current = dependencies();
    const service = new CaptureOwnedDataCleanupService(current);

    const report = await service.cleanupJob("job-1", 7);

    expect(report).toEqual({
      deletedJobs: 1,
      deletedTiles: 5,
      deletedArtifacts: 3,
      deletedManifests: 1,
      clearedSessions: 1,
    });
    expect(current.deleteManifest).toHaveBeenCalledWith("job-1");
    expect(current.deleteSessionJob).toHaveBeenCalledWith("job-1");
  });

  it("continues best-effort cleanup and returns a safe partial warning", async () => {
    const current = dependencies({ failArtifacts: true });
    const service = new CaptureOwnedDataCleanupService(current);

    const report = await service.cleanupJob("job-1", 7);

    expect(report.deletedJobs).toBe(1);
    expect(report.deletedTiles).toBe(5);
    expect(report.warning).toMatchObject({
      code: "E_CLEANUP_PARTIAL",
      causeCode: "CaptureOwnedDataCleanupPartial",
    });
    expect(current.deleteSessionJob).toHaveBeenCalledTimes(1);
  });
});
