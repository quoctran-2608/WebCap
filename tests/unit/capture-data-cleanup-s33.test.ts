import { describe, expect, it, vi } from "vitest";

import { CaptureOwnedDataCleanupService } from "@background/capture-data-cleanup-service";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { PdfWriterCheckpoint } from "@storage/pdf-writer-checkpoint-repository";

const checkpoint: PdfWriterCheckpoint = {
  schemaVersion: 1,
  jobId: "job-1",
  outputArtifactId: "output-1",
  spoolReference: "webcap-pdf-output/output-1.pdf",
  pagesWritten: 2,
  totalPages: 4,
  byteLength: 100,
  createdAt: "2026-08-08T05:00:00.000Z",
  updatedAt: "2026-08-08T05:01:00.000Z",
  expiresAt: "2026-08-08T05:30:00.000Z",
};

function output(artifactId: string, reference: string): ArtifactRecord {
  return {
    artifactId,
    sourceArtifactId: "job-1",
    jobId: "job-1",
    role: "output",
    format: "pdf",
    mimeType: "application/pdf",
    filename: `${artifactId}.pdf`,
    byteLength: 100,
    width: 595,
    height: 842,
    pageCount: 2,
    createdAt: "2026-08-08T05:00:00.000Z",
    expiresAt: "2026-08-08T05:30:00.000Z",
    opfsReference: reference,
  };
}

describe("S33 capture-owned OPFS cleanup", () => {
  it("deletes output references, active writer family and checkpoint before metadata", async () => {
    const order: string[] = [];
    const deleteSpool = vi.fn((reference: string) => {
      order.push(`spool:${reference}`);
      return Promise.resolve();
    });
    const deleteFamily = vi.fn((artifactId: string, totalPages: number) => {
      order.push(`family:${artifactId}:${totalPages}`);
      return Promise.resolve();
    });
    const deleteCheckpoint = vi.fn(() => {
      order.push("checkpoint");
      return Promise.resolve(true);
    });
    const deleteArtifacts = vi.fn(() => {
      order.push("artifacts");
      return Promise.resolve(2);
    });

    const service = new CaptureOwnedDataCleanupService({
      jobs: { delete: () => Promise.resolve(true) },
      sessions: {
        getSummary: () => Promise.resolve(undefined),
        getTabLock: () => Promise.resolve(undefined),
        deleteJob: () => Promise.resolve(),
      },
      tiles: { deleteByJob: () => Promise.resolve(0) },
      artifacts: { deleteByJob: deleteArtifacts },
      artifactLookup: {
        listByJob: () =>
          Promise.resolve([
            output("part-1", "webcap-pdf-output/part-1.pdf"),
            output("part-2", "webcap-pdf-output/part-2.pdf"),
          ]),
      },
      pdfSpool: { delete: deleteSpool, deleteOutputFamily: deleteFamily },
      pdfWriterCheckpoints: {
        get: () => Promise.resolve(checkpoint),
        delete: deleteCheckpoint,
      },
      manifests: { load: () => Promise.resolve(undefined), delete: () => Promise.resolve(false) },
      pdfDocuments: { get: () => Promise.resolve(undefined), delete: () => Promise.resolve(false) },
    });

    const report = await service.cleanupJob("job-1");

    expect(report.warning).toBeUndefined();
    expect(deleteSpool).toHaveBeenCalledTimes(3);
    expect(deleteSpool).toHaveBeenCalledWith("webcap-pdf-output/part-1.pdf");
    expect(deleteSpool).toHaveBeenCalledWith("webcap-pdf-output/part-2.pdf");
    expect(deleteSpool).toHaveBeenCalledWith("webcap-pdf-output/output-1.pdf");
    expect(deleteFamily).toHaveBeenCalledWith("output-1", 4);
    expect(deleteCheckpoint).toHaveBeenCalledWith("job-1");
    expect(order.indexOf("checkpoint")).toBeLessThan(order.indexOf("artifacts"));
  });
});
