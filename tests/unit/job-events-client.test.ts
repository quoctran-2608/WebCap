import { describe, expect, it, vi } from "vitest";

import {
  shouldRefreshJobFromSummary,
  subscribeToJobSummaryChanges,
  type RuntimeMessageEventPort,
  type RuntimeMessageListener,
} from "@popup/job-events-client";
import { createJobSummaryChangedEvent } from "@shared/contracts/job-events";
import type { JobSummary } from "@shared/contracts/job";

const summary: JobSummary = {
  schemaVersion: 1,
  jobId: "job-event",
  tabId: 7,
  mode: "full-page",
  state: "capturing",
  stateRevision: 4,
  completedTiles: 3,
  totalTiles: 10,
  updatedAt: "2026-08-06T00:01:00.000Z",
  expiresAt: "2026-08-06T00:31:00.000Z",
};

class MemoryRuntimeEvents implements RuntimeMessageEventPort {
  listener: RuntimeMessageListener | undefined;

  addListener(listener: RuntimeMessageListener): void {
    this.listener = listener;
  }

  removeListener(listener: RuntimeMessageListener): void {
    if (this.listener === listener) this.listener = undefined;
  }
}

describe("job summary event client", () => {
  it("refreshes only a newer revision for the current tab and job", () => {
    const current = { jobId: "job-event", tabId: 7, stateRevision: 3 };

    expect(shouldRefreshJobFromSummary(summary, current)).toBe(true);
    expect(
      shouldRefreshJobFromSummary({ ...summary, stateRevision: 3 }, current),
    ).toBe(false);
    expect(
      shouldRefreshJobFromSummary({ ...summary, stateRevision: 2 }, current),
    ).toBe(false);
    expect(
      shouldRefreshJobFromSummary({ ...summary, jobId: "other" }, current),
    ).toBe(false);
    expect(
      shouldRefreshJobFromSummary({ ...summary, tabId: 8 }, current),
    ).toBe(false);
  });

  it("forwards only validated job summary events", () => {
    const events = new MemoryRuntimeEvents();
    const callback = vi.fn();
    subscribeToJobSummaryChanges(callback, events);

    events.listener?.({ type: "JOB_SUMMARY_CHANGED", payload: { summary } });
    expect(callback).not.toHaveBeenCalled();

    events.listener?.(
      createJobSummaryChangedEvent({
        summary,
        sentAt: "2026-08-06T00:01:30.000Z",
      }),
    );
    expect(callback).toHaveBeenCalledWith(summary);
  });

  it("removes the exact listener during popup cleanup", () => {
    const events = new MemoryRuntimeEvents();
    const callback = vi.fn();
    const unsubscribe = subscribeToJobSummaryChanges(callback, events);
    expect(events.listener).toBeDefined();

    unsubscribe();
    expect(events.listener).toBeUndefined();
  });
});
