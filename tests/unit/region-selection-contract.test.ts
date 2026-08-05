import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "@shared/constants";
import {
  RegionSelectionOpenedMessageSchema,
  createRegionSelectionCancelMessage,
  createRegionSelectionCommitMessage,
  createRegionSelectionOpenMessage,
  parseRegionSelectionEvent,
  parseRegionSelectionOpenResponse,
} from "@shared/contracts/region-selection";

const sentAt = "2026-08-05T00:30:00.000Z";
const capabilities = {
  pointerCreate: true as const,
  keyboardCreate: true as const,
  autoScroll: true as const,
  resizeHandles: 8 as const,
};

describe("region selection protocol", () => {
  it("creates typed open, commit, and cancel envelopes", () => {
    expect(
      createRegionSelectionOpenMessage({ requestId: "open-1", jobId: "job-1", sentAt }),
    ).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      type: "REGION_SELECTION_OPEN",
      payload: { jobId: "job-1" },
    });
    expect(
      createRegionSelectionCommitMessage({
        requestId: "commit-1",
        jobId: "job-1",
        rect: { x: 10, y: 20, width: 300, height: 400 },
        sentAt,
      }),
    ).toMatchObject({
      type: "REGION_SELECTION_COMMIT",
      payload: { rect: { x: 10, y: 20, width: 300, height: 400 } },
    });
    expect(
      createRegionSelectionCancelMessage({
        requestId: "cancel-1",
        jobId: "job-1",
        reason: "escape",
        sentAt,
      }),
    ).toMatchObject({
      type: "REGION_SELECTION_CANCEL",
      payload: { reason: "escape" },
    });
  });

  it("rejects selections smaller than the minimum CSS size", () => {
    expect(() =>
      createRegionSelectionCommitMessage({
        requestId: "commit-small",
        jobId: "job-1",
        rect: { x: 1, y: 1, width: 1, height: 20 },
        sentAt,
      }),
    ).toThrow();
  });

  it("accepts only a fully ready selector response", () => {
    const opened = RegionSelectionOpenedMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "open-1",
      source: "content",
      target: "background",
      type: "REGION_SELECTION_OPENED",
      payload: {
        jobId: "job-1",
        selectorInstanceId: "selector-1",
        readyAt: sentAt,
        reused: false,
        capabilities,
      },
      sentAt,
    });
    expect(parseRegionSelectionOpenResponse(opened, "open-1")).toEqual({
      ok: true,
      value: opened,
    });

    const incomplete = parseRegionSelectionOpenResponse(
      {
        ...opened,
        payload: { jobId: "job-1", reused: false },
      },
      "open-1",
    );
    expect(incomplete).toMatchObject({
      ok: false,
      error: { code: "E_PROTOCOL_MESSAGE", causeCode: "InvalidRegionSelectionResponse" },
    });
  });

  it("rejects malformed content events", () => {
    expect(
      parseRegionSelectionEvent({
        protocolVersion: PROTOCOL_VERSION,
        requestId: "bad",
        source: "content",
        target: "background",
        type: "REGION_SELECTION_COMMIT",
        payload: { jobId: "job-1", rect: { x: 0, y: 0, width: -1, height: 2 } },
        sentAt,
      }),
    ).toMatchObject({ ok: false, error: { code: "E_PROTOCOL_MESSAGE" } });
  });
});
