import { describe, expect, it } from "vitest";

import {
  JobCreateMessageSchema,
  createJobCreateMessage,
  createJobResponseMessage,
  parsePersistentJobRequest,
} from "@shared/contracts/job-messages";
import type { CaptureJob } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const sentAt = "2026-08-02T16:00:00.000Z";

function job(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { createdAt: sentAt },
    mode: "full-page",
    preferredEngine: "cdp",
    state: "created",
    stateRevision: 0,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: sentAt,
    updatedAt: sentAt,
    expiresAt: "2026-08-02T16:30:00.000Z",
  };
}

describe("persistent job messages", () => {
  it("creates a strict JOB_CREATE request", () => {
    const message = createJobCreateMessage({
      requestId: "request-1",
      sentAt,
      tabId: 7,
      windowId: 2,
      mode: "full-page",
      settings: DEFAULT_CAPTURE_SETTINGS,
      source: { title: "Fixture", origin: "http://127.0.0.1" },
    });
    expect(JobCreateMessageSchema.parse(message)).toEqual(message);
  });

  it("rejects unknown fields at the runtime boundary", () => {
    const message = {
      ...createJobCreateMessage({
        requestId: "request-1",
        sentAt,
        tabId: 7,
        windowId: 2,
        mode: "full-page",
        settings: DEFAULT_CAPTURE_SETTINGS,
      }),
      unexpected: true,
    };
    expect(parsePersistentJobRequest(message)).toMatchObject({
      ok: false,
      error: { code: "E_PROTOCOL_MESSAGE" },
    });
  });

  it("returns protocol mismatch without throwing", () => {
    const message = {
      ...createJobCreateMessage({
        requestId: "request-1",
        sentAt,
        tabId: 7,
        windowId: 2,
        mode: "full-page",
        settings: DEFAULT_CAPTURE_SETTINGS,
      }),
      protocolVersion: 99,
    };
    expect(parsePersistentJobRequest(message)).toMatchObject({
      ok: false,
      error: { code: "E_PROTOCOL_VERSION" },
    });
  });

  it("creates a metadata-only JOB_RESPONSE", () => {
    const response = createJobResponseMessage({
      requestId: "request-1",
      sentAt,
      job: job(),
    });
    expect(response.payload.job.id).toBe("job-1");
    expect(JSON.stringify(response)).not.toContain("blob");
  });
});
