import { describe, expect, it, vi } from "vitest";

import {
  routePdfExportProgressMessage,
  routePersistentJobMessage,
  type PersistentJobRouterDependencies,
} from "@background/persistent-job-router";
import type { PersistentJobCoordinatorPort } from "@background/job-coordinator";
import type { CaptureJob } from "@shared/contracts/domain";
import { createPdfExportStartMessage } from "@shared/contracts/job-messages";
import { createOffscreenPdfExportProgressMessage } from "@shared/contracts/offscreen";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { DedupeRepositoryPort } from "@storage/dedupe-repository";

const NOW = new Date("2026-08-03T11:00:00.000Z");

function exportingJob(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { createdAt: NOW.toISOString() },
    mode: "full-page",
    preferredEngine: "cdp",
    activeEngine: "cdp",
    state: "exporting",
    stateRevision: 5,
    targetRect: { x: 0, y: 0, width: 100, height: 300 },
    tilePlan: [],
    completedTiles: 1,
    totalTiles: 1,
    settings: DEFAULT_CAPTURE_SETTINGS,
    exportProgress: { completedPages: 0, totalPages: 3 },
    cleanup: { attempted: true, completed: true },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: "2026-08-03T11:30:00.000Z",
  };
}

function dedupe(): DedupeRepositoryPort {
  return {
    get: () => Promise.resolve(undefined),
    put: () => Promise.resolve(),
    deleteExpired: () => Promise.resolve(0),
  };
}

function dependencies() {
  const start = vi.fn(() => Promise.resolve(exportingJob()));
  const handleProgress = vi.fn(() => Promise.resolve(exportingJob()));
  const value: PersistentJobRouterDependencies = {
    jobs: {} as PersistentJobCoordinatorPort,
    dedupe: dedupe(),
    pdfExports: { start, handleProgress },
    now: () => NOW,
  };
  return { value, start, handleProgress };
}

describe("PDF export routing", () => {
  it("routes PDF_EXPORT_START through the persistent job response contract", async () => {
    const current = dependencies();
    const settings = {
      ...DEFAULT_CAPTURE_SETTINGS.pdf,
      pageSize: "letter" as const,
      orientation: "landscape" as const,
    };
    const message = createPdfExportStartMessage({
      requestId: "pdf-start-1",
      sentAt: NOW.toISOString(),
      jobId: "job-1",
      settings,
    });

    const response = await routePersistentJobMessage(message, current.value);

    expect(response).toMatchObject({
      type: "JOB_RESPONSE",
      requestId: "pdf-start-1",
      payload: {
        job: {
          id: "job-1",
          state: "exporting",
          exportProgress: { completedPages: 0, totalPages: 3 },
        },
      },
    });
    expect(current.start).toHaveBeenCalledWith("job-1", settings);
  });

  it("acknowledges offscreen progress after persisting it through the export service", async () => {
    const current = dependencies();
    const message = createOffscreenPdfExportProgressMessage({
      requestId: "progress-1",
      sentAt: NOW.toISOString(),
      jobId: "job-1",
      completedPages: 2,
      totalPages: 3,
    });

    const response = await routePdfExportProgressMessage(message, current.value);

    expect(response).toMatchObject({
      type: "OFFSCREEN_PDF_EXPORT_PROGRESS_ACK",
      requestId: "progress-1",
      payload: { jobId: "job-1", accepted: true },
    });
    expect(current.handleProgress).toHaveBeenCalledWith({
      jobId: "job-1",
      completedPages: 2,
      totalPages: 3,
    });
  });
});
