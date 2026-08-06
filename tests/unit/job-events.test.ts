import { describe, expect, it } from "vitest";

import {
  createJobSummaryChangedEvent,
  isJobSummaryChangedEvent,
} from "@shared/contracts/job-events";
import { summarizeJob } from "@shared/contracts/job";
import type { CaptureJob } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

function job(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-event",
    tabId: 7,
    windowId: 2,
    source: { createdAt: "2026-08-06T00:00:00.000Z" },
    mode: "full-page",
    preferredEngine: "scroll",
    state: "capturing",
    stateRevision: 4,
    tilePlan: [],
    completedTiles: 3,
    totalTiles: 10,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:01:00.000Z",
    expiresAt: "2026-08-06T00:31:00.000Z",
  };
}

describe("job summary events", () => {
  it("creates a metadata-only event from the durable summary", () => {
    const summary = summarizeJob(job());
    const event = createJobSummaryChangedEvent({
      summary,
      sentAt: "2026-08-06T00:01:00.000Z",
    });

    expect(event).toEqual({
      protocolVersion: 1,
      source: "background",
      target: "popup",
      type: "JOB_SUMMARY_CHANGED",
      payload: { summary },
      sentAt: "2026-08-06T00:01:00.000Z",
    });
    expect(JSON.stringify(event)).not.toContain("blob");
    expect(JSON.stringify(event)).not.toContain("data:");
  });

  it("rejects malformed or binary-extended messages", () => {
    const event = createJobSummaryChangedEvent({
      summary: summarizeJob(job()),
      sentAt: "2026-08-06T00:01:00.000Z",
    });

    expect(isJobSummaryChangedEvent(event)).toBe(true);
    expect(isJobSummaryChangedEvent({ ...event, blob: new Blob(["unsafe"]) })).toBe(false);
    expect(
      isJobSummaryChangedEvent({
        ...event,
        payload: { summary: { ...event.payload.summary, stateRevision: -1 } },
      }),
    ).toBe(false);
  });
});
