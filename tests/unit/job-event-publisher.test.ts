import { describe, expect, it, vi } from "vitest";

import {
  ChromeJobSummaryEventPublisher,
  type RuntimeEventMessenger,
} from "@background/job-event-publisher";
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

describe("ChromeJobSummaryEventPublisher", () => {
  it("publishes a versioned job summary event", async () => {
    const sendMessage = vi.fn(() => Promise.resolve(undefined));
    const runtime: RuntimeEventMessenger = { sendMessage };
    const publisher = new ChromeJobSummaryEventPublisher(
      runtime,
      () => new Date("2026-08-06T00:01:30.000Z"),
    );

    await publisher.publish(summary);

    expect(sendMessage).toHaveBeenCalledWith({
      protocolVersion: 1,
      source: "background",
      target: "popup",
      type: "JOB_SUMMARY_CHANGED",
      payload: { summary },
      sentAt: "2026-08-06T00:01:30.000Z",
    });
  });

  it("does not fail capture state when no popup listener exists", async () => {
    const runtime: RuntimeEventMessenger = {
      sendMessage: () => Promise.reject(new Error("Receiving end does not exist.")),
    };
    const publisher = new ChromeJobSummaryEventPublisher(runtime);

    await expect(publisher.publish(summary)).resolves.toBeUndefined();
  });
});
