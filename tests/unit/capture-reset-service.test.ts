import { describe, expect, it, vi } from "vitest";

import { CaptureResetService } from "@background/capture-reset-service";
import type { CaptureOwnedDataCleanupPort } from "@background/capture-data-cleanup-service";
import type { PersistentJobCoordinatorPort } from "@background/job-coordinator";
import { createCaptureResetRequest } from "@shared/contracts/capture-reset";
import type { CaptureJob } from "@shared/contracts/domain";
import type { VisibleSessionSnapshot } from "@shared/contracts/visible-session";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const now = "2026-08-04T15:00:00.000Z";

function job(state: CaptureJob["state"] = "ready"): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { createdAt: now },
    mode: "full-page",
    preferredEngine: "cdp",
    state,
    stateRevision: 2,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: state !== "created", completed: state !== "created" },
    createdAt: now,
    updatedAt: now,
    expiresAt: "2026-08-04T15:30:00.000Z",
  };
}

function createFixture(
  options: {
    currentJob?: CaptureJob;
    visibleSession?: VisibleSessionSnapshot;
  } = {},
) {
  const currentJob = options.currentJob;
  let visibleSession = options.visibleSession;
  const jobs = {
    get: vi.fn(() => Promise.resolve(currentJob)),
    getActiveForTab: vi.fn(() => Promise.resolve(currentJob)),
    cancel: vi.fn(() => Promise.resolve({ ...(currentJob ?? job()), state: "cancelled" as const })),
  } as unknown as PersistentJobCoordinatorPort;
  const cleanupJob = vi.fn(() =>
    Promise.resolve({
      deletedJobs: currentJob === undefined ? 0 : 1,
      deletedTiles: currentJob === undefined ? 0 : 4,
      deletedArtifacts: currentJob === undefined ? 0 : 2,
      deletedManifests: currentJob === undefined ? 0 : 1,
      clearedSessions: currentJob === undefined ? 0 : 1,
    }),
  );
  const cleanup: CaptureOwnedDataCleanupPort = { cleanupJob };
  const captures = {
    cancel: vi.fn(() => Promise.resolve({ ...(currentJob ?? job()), state: "cancelled" as const })),
    waitForIdle: vi.fn(() => Promise.resolve()),
  };
  const visibleSessions = {
    load: vi.fn(() => Promise.resolve(visibleSession)),
    save: vi.fn((next: VisibleSessionSnapshot) => {
      visibleSession = next;
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      visibleSession = undefined;
      return Promise.resolve();
    }),
  };
  const releaseCapture = vi.fn(() => true);
  const visibleCapture = {
    start: vi.fn(),
    cancel: vi.fn(() => true),
    waitForIdle: vi.fn(() => Promise.resolve()),
    releaseCapture,
  };
  const imageExport = { cancelBySourceArtifactId: vi.fn(() => Promise.resolve()) };
  const artifacts = { delete: vi.fn(() => Promise.resolve(true)) };
  const artifactsByJob = { deleteByJob: vi.fn(() => Promise.resolve(2)) };
  const service = new CaptureResetService({
    jobs,
    cleanup,
    captures,
    scrollAreaCaptures: captures,
    pdfExports: {
      cancel: captures.cancel,
      waitForIdle: captures.waitForIdle,
    },
    visibleSessions,
    visibleCapture,
    imageExport,
    artifacts,
    artifactsByJob,
  });
  return {
    service,
    jobs,
    cleanup,
    cleanupJob,
    captures,
    visibleSessions,
    visibleCapture,
    releaseCapture,
    imageExport,
    artifactsByJob,
    getVisibleSession: () => visibleSession,
  };
}

describe("CaptureResetService", () => {
  it("cleans a ready terminal checkpoint without unnecessary cancellation", async () => {
    const current = createFixture({ currentJob: job("ready") });
    const report = await current.service.reset(
      createCaptureResetRequest({
        requestId: "reset-1",
        sentAt: now,
        scope: "job",
        jobId: "job-1",
      }),
    );

    expect(report).toMatchObject({
      scope: "job",
      jobId: "job-1",
      cancellationAttempted: false,
      cancellationCompleted: true,
      deletedJobs: 1,
      deletedTiles: 4,
      deletedArtifacts: 2,
      deletedManifests: 1,
      clearedSessions: 1,
    });
    expect(current.captures.cancel).not.toHaveBeenCalled();
  });

  it("cancels and waits for an active capture before deleting owned data", async () => {
    const current = createFixture({ currentJob: job("capturing") });
    await current.service.reset(
      createCaptureResetRequest({
        requestId: "reset-2",
        sentAt: now,
        scope: "job",
        jobId: "job-1",
      }),
    );

    expect(current.captures.cancel).toHaveBeenCalledWith("job-1", "capture reset", "discard");
    expect(current.captures.waitForIdle).toHaveBeenCalledWith("job-1");
    expect(current.cleanupJob.mock.invocationCallOrder[0] ?? 0).toBeGreaterThan(
      current.captures.waitForIdle.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("is idempotent when the job record is already missing", async () => {
    const current = createFixture();
    const report = await current.service.reset(
      createCaptureResetRequest({
        requestId: "reset-missing",
        sentAt: now,
        scope: "job",
        jobId: "missing",
      }),
    );
    expect(report).toMatchObject({ deletedJobs: 0, cancellationAttempted: false });
    expect(current.cleanupJob).toHaveBeenCalledWith("missing", undefined);
  });

  it("cancels visible processing, removes all artifacts linked to the source, and clears session", async () => {
    const visibleSession: VisibleSessionSnapshot = {
      schemaVersion: 1,
      sessionId: "visible-1",
      captureRequestId: "visible-1",
      status: "processing",
      format: "png",
      quality: 0.92,
      source: {
        captureId: "capture-1",
        tabId: 7,
        windowId: 2,
        mimeType: "image/png",
        byteLength: 100,
        width: 10,
        height: 10,
      },
      createdAt: now,
      updatedAt: now,
    };
    const current = createFixture({ visibleSession });
    const report = await current.service.reset(
      createCaptureResetRequest({
        requestId: "reset-visible",
        sentAt: now,
        scope: "visible-session",
      }),
    );

    expect(current.imageExport.cancelBySourceArtifactId).toHaveBeenCalledWith("capture-1");
    expect(current.artifactsByJob.deleteByJob).toHaveBeenCalledWith("capture-1");
    expect(current.releaseCapture).toHaveBeenCalledWith("capture-1");
    expect(current.getVisibleSession()).toBeUndefined();
    expect(report).toMatchObject({
      cancellationAttempted: true,
      cancellationCompleted: true,
      deletedArtifacts: 2,
      clearedSessions: 1,
    });
  });
});
