import { describe, expect, it, vi } from "vitest";

import { PersistentJobCoordinator } from "@background/job-coordinator";
import type { CaptureJob } from "@shared/contracts/domain";
import type { JobSummary, TabJobLock } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { JobRepositoryPort } from "@storage/job-repository";
import type { JobSessionRepositoryPort } from "@storage/job-session-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

function adaptiveJob(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "adaptive-recovery",
    tabId: 7,
    windowId: 3,
    source: { createdAt: "2026-08-05T00:00:00.000Z" },
    mode: "full-page",
    preferredEngine: "scroll",
    activeEngine: "scroll",
    state: "capturing",
    stateRevision: 5,
    metrics: {
      document: { x: 0, y: 0, width: 100, height: 260 },
      layoutViewport: { x: 0, y: 0, width: 100, height: 100 },
      visualViewport: { x: 0, y: 0, width: 100, height: 100, scale: 1 },
      devicePixelRatio: 1,
      zoomFactor: 1,
      scrollX: 0,
      scrollY: 0,
    },
    targetRect: { x: 0, y: 0, width: 100, height: 180 },
    tilePlan: [
      {
        id: "adaptive-recovery:0",
        jobId: "adaptive-recovery",
        index: 0,
        row: 0,
        column: 0,
        sourceRectCss: { x: 0, y: 0, width: 100, height: 100 },
        outputRectCss: { x: 0, y: 0, width: 100, height: 100 },
        scrollXCss: 0,
        scrollYCss: 0,
        expectedPixelWidth: 100,
        expectedPixelHeight: 100,
        overlapTopCss: 0,
        overlapLeftCss: 0,
        overlapRightCss: 0,
        overlapBottomCss: 0,
        status: "stored",
        attempts: 1,
        byteLength: 80,
        mimeType: "image/png",
      },
      {
        id: "adaptive-recovery:1",
        jobId: "adaptive-recovery",
        index: 1,
        row: 1,
        column: 0,
        sourceRectCss: { x: 0, y: 80, width: 100, height: 100 },
        outputRectCss: { x: 0, y: 100, width: 100, height: 80 },
        scrollXCss: 0,
        scrollYCss: 80,
        expectedPixelWidth: 100,
        expectedPixelHeight: 100,
        overlapTopCss: 20,
        overlapLeftCss: 0,
        overlapRightCss: 0,
        overlapBottomCss: 0,
        status: "planned",
        attempts: 0,
      },
    ],
    completedTiles: 1,
    totalTiles: 2,
    adaptiveFrontier: {
      schemaVersion: 1,
      nextYCss: 100,
      capturedBottomCss: 100,
      observedDocumentHeightCss: 260,
      stableBottomRounds: 0,
      capturedRows: 1,
      storedBytes: 80,
      startedAt: "2026-08-05T00:00:00.000Z",
      lastGrowthAt: "2026-08-05T00:00:01.000Z",
      sourceDocumentToken: "document-1",
      documentWidthCss: 100,
      viewportWidthCss: 100,
      viewportHeightCss: 100,
      devicePixelRatio: 1,
    },
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:05.000Z",
    expiresAt: "2026-08-05T00:30:00.000Z",
  };
}

describe("adaptive capture recovery", () => {
  it("keeps a persisted adaptive prefix resumable instead of failing it on worker restart", async () => {
    const initial = adaptiveJob();
    let stored = structuredClone(initial);
    const summaries = new Map<string, JobSummary>();
    const locks = new Map<number, TabJobLock>();
    const cleanup = vi.fn(() => Promise.resolve());

    const jobs: JobRepositoryPort = {
      create: () => Promise.resolve(),
      get: () => Promise.resolve(structuredClone(stored)),
      save(job, expectedRevision) {
        expect(expectedRevision).toBe(stored.stateRevision);
        stored = structuredClone(job);
        return Promise.resolve();
      },
      listActive: () => Promise.resolve([structuredClone(stored)]),
      listExpired: () => Promise.resolve([]),
      delete: () => Promise.resolve(false),
    };
    const sessions: JobSessionRepositoryPort = {
      getSummary: (jobId) => Promise.resolve(summaries.get(jobId)),
      listSummaries: () => Promise.resolve([...summaries.values()]),
      saveSummary(summary) {
        summaries.set(summary.jobId, structuredClone(summary));
        return Promise.resolve();
      },
      getTabLock: (tabId) => Promise.resolve(locks.get(tabId)),
      acquireTabLock(lock) {
        locks.set(lock.tabId, structuredClone(lock));
        return Promise.resolve(true);
      },
      releaseTabLock: () => Promise.resolve(),
      deleteJob: () => Promise.resolve(),
      clearExpiredLocks: () => Promise.resolve(0),
    };
    const tiles: TileRepositoryPort = {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(undefined),
      listByJob: () => Promise.resolve([]),
      deleteByJob: () => Promise.resolve(0),
    };
    const coordinator = new PersistentJobCoordinator({
      jobs,
      sessions,
      tiles,
      artifacts: { deleteByJob: () => Promise.resolve(0) },
      cleanup: { cleanup },
      now: () => new Date("2026-08-05T00:00:10.000Z"),
    });

    await coordinator.initialize();

    expect(cleanup).not.toHaveBeenCalled();
    expect(stored).toMatchObject({
      state: "capturing",
      stateRevision: 5,
      completedTiles: 1,
      totalTiles: 2,
      adaptiveFrontier: {
        capturedBottomCss: 100,
        capturedRows: 1,
        sourceDocumentToken: "document-1",
      },
    });
    expect(summaries.get(initial.id)).toMatchObject({ state: "capturing", completedTiles: 1 });
    expect(locks.get(initial.tabId)).toMatchObject({ jobId: initial.id });
  });
});
