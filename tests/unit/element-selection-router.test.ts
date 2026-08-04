import { describe, expect, it, vi } from "vitest";

import {
  routeElementSelectionMessage,
  type PersistentJobRouterDependencies,
} from "@background/persistent-job-router";
import type { JobCleanupReport, PersistentJobCoordinatorPort } from "@background/job-coordinator";
import { PROTOCOL_VERSION } from "@shared/constants";
import type { CaptureJob } from "@shared/contracts/domain";
import {
  ElementSelectionCommitMessageSchema,
  ElementSelectionCancelMessageSchema,
} from "@shared/contracts/element-selection";
import type { StoredDedupeRecord } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { DedupeRepositoryPort } from "@storage/dedupe-repository";

const now = new Date("2026-08-03T09:00:00.000Z");
const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "selection-1",
  tagName: "article",
  id: "target-card",
  classNames: ["card"],
  scrollable: false,
  captureKind: "visible-bounds" as const,
};

const scrollDescriptor = {
  schemaVersion: 1 as const,
  selectionId: "scroll-selection-1",
  tagName: "section",
  id: "scroll-panel",
  classNames: ["scroll-panel"],
  scrollable: true,
  captureKind: "full-scroll-content" as const,
};

function elementJob(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "element-job",
    tabId: 7,
    windowId: 2,
    source: { createdAt: now.toISOString() },
    mode: "element",
    preferredEngine: "cdp",
    state: "created",
    stateRevision: 0,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: "2026-08-03T09:30:00.000Z",
  };
}

function scrollAreaJob(): CaptureJob {
  return {
    ...elementJob(),
    id: "scroll-area-job",
    mode: "scroll-area",
    preferredEngine: "scroll",
  };
}

class MemoryDedupe implements DedupeRepositoryPort {
  get(): Promise<StoredDedupeRecord | undefined> {
    return Promise.resolve(undefined);
  }
  put(): Promise<void> {
    return Promise.resolve();
  }
  deleteExpired(): Promise<number> {
    return Promise.resolve(0);
  }
}

class ElementJobs implements PersistentJobCoordinatorPort {
  current: CaptureJob | undefined = elementJob();
  readonly updateCall = vi.fn();
  readonly cancelCall = vi.fn();

  initialize(): Promise<void> {
    return Promise.resolve();
  }
  create(): Promise<CaptureJob> {
    return Promise.resolve(elementJob());
  }
  get(): Promise<CaptureJob | undefined> {
    return Promise.resolve(this.current);
  }
  getActiveForTab(tabId: number): Promise<CaptureJob | undefined> {
    return Promise.resolve(this.current?.tabId === tabId ? this.current : undefined);
  }
  update(_jobId: string, patch: Partial<CaptureJob>): Promise<CaptureJob> {
    this.updateCall(patch);
    this.current = { ...(this.current ?? elementJob()), ...patch, stateRevision: 1 };
    return Promise.resolve(this.current);
  }
  transition(): Promise<CaptureJob> {
    return Promise.resolve(this.current ?? elementJob());
  }
  cancel(jobId: string, reason?: string): Promise<CaptureJob> {
    this.cancelCall(jobId, reason);
    const cancelled: CaptureJob = {
      ...(this.current ?? elementJob()),
      state: "cancelled",
      stateRevision: 2,
      cleanup: { attempted: true, completed: true },
      error: {
        code: "E_CANCELLED",
        stage: "cleanup",
        message: "cancelled",
        userMessageKey: "errors.cancelled",
        retryable: true,
        fallbackAllowed: false,
      },
    };
    this.current = cancelled;
    return Promise.resolve(cancelled);
  }
  cleanupExpired(): Promise<JobCleanupReport> {
    return Promise.resolve({
      deletedJobs: 0,
      skippedLeasedJobs: 0,
      failedJobs: 0,
      deletedTiles: 0,
      deletedArtifacts: 0,
      deletedManifests: 0,
      clearedSessions: 0,
    });
  }
}

function dependencies(jobs: ElementJobs, start = vi.fn(() => Promise.resolve())) {
  const value: PersistentJobRouterDependencies = {
    jobs,
    captures: {
      start,
      cancel: vi.fn(() => Promise.resolve(elementJob())),
    },
    dedupe: new MemoryDedupe(),
    now: () => now,
  };
  return { value, start };
}

const sender = { id: "extension-id", tab: { id: 7 } } as chrome.runtime.MessageSender;

describe("element selection routing", () => {
  it("stores bounds and descriptor before starting the tiled coordinator", async () => {
    const jobs = new ElementJobs();
    const current = dependencies(jobs);
    const rect = { x: 120, y: 240, width: 420, height: 180 };
    const message = ElementSelectionCommitMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "commit-1",
      source: "content",
      target: "background",
      type: "ELEMENT_SELECTION_COMMIT",
      payload: { jobId: "element-job", rect, descriptor },
      sentAt: now.toISOString(),
    });

    const response = await routeElementSelectionMessage(message, sender, current.value);

    expect(response).toMatchObject({
      type: "ELEMENT_SELECTION_EVENT_ACK",
      payload: { jobId: "element-job", accepted: true },
    });
    expect(jobs.updateCall).toHaveBeenCalledWith({
      targetRect: rect,
      targetDescriptor: descriptor,
    });
    expect(current.start).toHaveBeenCalledWith("element-job");
  });

  it("routes a full-scroll target to the dedicated scroll-area coordinator", async () => {
    const jobs = new ElementJobs();
    jobs.current = scrollAreaJob();
    const scrollStart = vi.fn(() => Promise.resolve());
    const current = dependencies(jobs);
    current.value.scrollAreaCaptures = {
      start: scrollStart,
      cancel: vi.fn(() => Promise.resolve(scrollAreaJob())),
    };
    const rect = { x: 0, y: 0, width: 900, height: 1800 };
    const message = ElementSelectionCommitMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "scroll-commit-1",
      source: "content",
      target: "background",
      type: "ELEMENT_SELECTION_COMMIT",
      payload: { jobId: "scroll-area-job", rect, descriptor: scrollDescriptor },
      sentAt: now.toISOString(),
    });

    const response = await routeElementSelectionMessage(message, sender, current.value);

    expect(response).toMatchObject({ type: "ELEMENT_SELECTION_EVENT_ACK" });
    expect(jobs.updateCall).toHaveBeenCalledWith({
      targetRect: rect,
      targetDescriptor: scrollDescriptor,
    });
    expect(scrollStart).toHaveBeenCalledWith("scroll-area-job");
    expect(current.start).not.toHaveBeenCalled();
  });

  it("cancels a created element job from the overlay", async () => {
    const jobs = new ElementJobs();
    const current = dependencies(jobs);
    const message = ElementSelectionCancelMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "cancel-1",
      source: "content",
      target: "background",
      type: "ELEMENT_SELECTION_CANCEL",
      payload: { jobId: "element-job", reason: "keyboard cancellation" },
      sentAt: now.toISOString(),
    });

    const response = await routeElementSelectionMessage(message, sender, current.value);

    expect(response).toMatchObject({ type: "ELEMENT_SELECTION_EVENT_ACK" });
    expect(jobs.cancelCall).toHaveBeenCalledWith("element-job", "keyboard cancellation");
    expect(current.start).not.toHaveBeenCalled();
  });

  it("rejects a commit from another tab without starting capture", async () => {
    const jobs = new ElementJobs();
    const current = dependencies(jobs);
    const message = ElementSelectionCommitMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "commit-other-tab",
      source: "content",
      target: "background",
      type: "ELEMENT_SELECTION_COMMIT",
      payload: {
        jobId: "element-job",
        rect: { x: 1, y: 1, width: 20, height: 20 },
        descriptor,
      },
      sentAt: now.toISOString(),
    });

    const response = await routeElementSelectionMessage(
      message,
      { ...sender, tab: { id: 9 } } as chrome.runtime.MessageSender,
      current.value,
    );

    expect(response).toMatchObject({
      type: "ERROR_RESPONSE",
      payload: { code: "E_PROTOCOL_MESSAGE", causeCode: "ElementSelectionJobMismatch" },
    });
    expect(current.start).not.toHaveBeenCalled();
  });
});
