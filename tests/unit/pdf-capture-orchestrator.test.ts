import { describe, expect, it } from "vitest";

import {
  PdfCaptureOrchestrator,
  negotiatePdfCaptureStrategy,
} from "@background/pdf-capture-orchestrator";
import type { CaptureJob, CaptureTile } from "@shared/contracts/domain";
import type { PdfDocumentManifest } from "@shared/contracts/pdf-capture";
import type { PdfSourceCapability } from "@shared/contracts/pdf-source";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { PdfDocumentManifestRepositoryPort } from "@storage/pdf-document-manifest-repository";

const NOW = new Date("2026-08-07T12:00:00.000Z");

class MemoryManifestRepository implements PdfDocumentManifestRepositoryPort {
  private record: PdfDocumentManifest | undefined;

  create(manifest: PdfDocumentManifest): Promise<void> {
    if (this.record !== undefined) throw new Error("duplicate manifest");
    this.record = structuredClone(manifest);
    return Promise.resolve();
  }

  get(jobId: string): Promise<PdfDocumentManifest | undefined> {
    return Promise.resolve(
      this.record?.jobId === jobId ? structuredClone(this.record) : undefined,
    );
  }

  save(manifest: PdfDocumentManifest, expectedRevision: number): Promise<void> {
    if (this.record === undefined || this.record.revision !== expectedRevision) {
      throw new Error("revision conflict");
    }
    this.record = structuredClone(manifest);
    return Promise.resolve();
  }

  delete(jobId: string): Promise<boolean> {
    const found = this.record?.jobId === jobId;
    if (found) this.record = undefined;
    return Promise.resolve(found);
  }

  listExpired(): Promise<PdfDocumentManifest[]> {
    return Promise.resolve([]);
  }
}

function tile(width = 100): CaptureTile {
  return {
    id: "job-1:0",
    jobId: "job-1",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 0, y: 0, width, height: 300 },
    outputRectCss: { x: 0, y: 0, width, height: 300 },
    expectedPixelWidth: width,
    expectedPixelHeight: 300,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    status: "stored",
    attempts: 1,
  };
}

function dedicatedJob(capturedTile = tile()): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { createdAt: NOW.toISOString() },
    mode: "scroll-area",
    preferredEngine: "scroll",
    activeEngine: "scroll",
    state: "ready",
    stateRevision: 4,
    targetRect: { x: 0, y: 0, width: 100, height: 300 },
    documentPageMap: {
      schemaVersion: 1,
      strategy: "dom",
      confidence: 1,
      complete: true,
      sourcePageCount: 2,
      pages: [
        { index: 0, sourceRectCss: { x: 0, y: 0, width: 100, height: 140 } },
        { index: 1, sourceRectCss: { x: 0, y: 160, width: 100, height: 140 } },
      ],
    },
    tilePlan: [capturedTile],
    completedTiles: 1,
    totalTiles: 1,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: true, completed: true },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: "2026-08-07T12:30:00.000Z",
  };
}

function orchestrator() {
  const repository = new MemoryManifestRepository();
  return {
    repository,
    service: new PdfCaptureOrchestrator({
      manifests: repository,
      now: () => NOW,
    }),
  };
}

function capability(
  patch: Partial<PdfSourceCapability> = {},
): PdfSourceCapability {
  return {
    status: "original-passthrough",
    permission: "granted",
    reason: "content-type",
    canDownloadOriginal: true,
    canCaptureViewer: true,
    signals: {
      urlExtension: false,
      contentType: true,
      chromePdfViewer: false,
      signature: false,
    },
    ...patch,
  };
}

describe("PdfCaptureOrchestrator", () => {
  it("bootstraps S27 page metadata and completes only after page verification", async () => {
    const { repository, service } = orchestrator();
    const job = dedicatedJob();

    const prepared = await service.prepareViewerExport(job);
    expect(prepared).toMatchObject({
      state: "writing",
      expectedPageCount: 2,
      progress: {
        discoveredPages: 2,
        capturedPages: 2,
        verifiedPages: 2,
        outputPages: 0,
      },
    });
    expect(prepared.pages.map((page) => page.state)).toEqual(["verified", "verified"]);

    const halfway = await service.recordOutputProgress(job.id, 1, 2);
    expect(halfway).toMatchObject({
      outputState: "writing",
      progress: { outputPages: 1 },
    });
    expect(halfway?.pages.map((page) => page.state)).toEqual(["written", "verified"]);

    const evidence = await service.completeViewerOutput(job, 2);
    expect(evidence).toMatchObject({
      jobId: job.id,
      expectedPageCount: 2,
      outputPageCount: 2,
      verified: true,
    });
    expect(await repository.get(job.id)).toMatchObject({
      state: "completed",
      outputState: "completed",
      progress: { discoveredPages: 2, capturedPages: 2, verifiedPages: 2, outputPages: 2 },
    });
  });

  it("rejects output page-count mismatch instead of reporting completion", async () => {
    const { service } = orchestrator();
    const job = dedicatedJob();
    await service.prepareViewerExport(job);

    await expect(service.completeViewerOutput(job, 1)).rejects.toMatchObject({
      data: { causeCode: "PdfOutputPageCountMismatch" },
    });
  });

  it("rejects a logical page with incomplete pixel coverage", async () => {
    const { service } = orchestrator();
    const job = dedicatedJob(tile(80));

    await expect(service.prepareViewerExport(job)).rejects.toMatchObject({
      data: { causeCode: "PdfPageCoverageGap" },
    });
  });

  it("negotiates original source first and viewer fallback when source access is blocked", () => {
    expect(negotiatePdfCaptureStrategy(capability())).toMatchObject({
      primaryStrategy: "original-source",
      fallbackStrategies: ["semantic-viewer", "visual-discovery"],
      reason: "original-available",
    });

    expect(
      negotiatePdfCaptureStrategy(
        capability({
          status: "auth-required",
          permission: "granted",
          reason: "auth-required",
          canDownloadOriginal: false,
        }),
      ),
    ).toMatchObject({
      primaryStrategy: "semantic-viewer",
      fallbackStrategies: ["visual-discovery"],
      reason: "source-auth-required",
    });
  });
});
