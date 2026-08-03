import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "@shared/constants";
import {
  ElementSelectionCommitMessageSchema,
  ElementSelectionErrorMessageSchema,
  ElementSelectionOpenedMessageSchema,
  ElementTargetValidatedMessageSchema,
  createElementSelectionOpenMessage,
  createElementTargetRevalidateMessage,
  parseElementSelectionEvent,
  parseElementSelectionOpenResponse,
  parseElementTargetRevalidateResponse,
} from "@shared/contracts/element-selection";

const sentAt = "2026-08-03T09:00:00.000Z";
const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "selection-1",
  tagName: "button",
  id: "save-action",
  classNames: ["primary", "large"],
  scrollable: false,
  captureKind: "visible-bounds" as const,
};

describe("element selection protocol", () => {
  it("creates open and revalidation requests without page content", () => {
    expect(
      createElementSelectionOpenMessage({ requestId: "open-1", jobId: "job-1", sentAt }),
    ).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      type: "ELEMENT_SELECTION_OPEN",
      payload: { jobId: "job-1" },
    });
    expect(
      createElementTargetRevalidateMessage({
        requestId: "validate-1",
        jobId: "job-1",
        descriptor,
        sentAt,
      }),
    ).toMatchObject({
      type: "ELEMENT_TARGET_REVALIDATE",
      payload: { descriptor },
    });
  });

  it("accepts a typed commit and rejects empty bounds", () => {
    const commit = ElementSelectionCommitMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "commit-1",
      source: "content",
      target: "background",
      type: "ELEMENT_SELECTION_COMMIT",
      payload: {
        jobId: "job-1",
        rect: { x: 20, y: 30, width: 240, height: 80 },
        descriptor,
      },
      sentAt,
    });
    expect(parseElementSelectionEvent(commit)).toEqual({ ok: true, value: commit });
    expect(
      parseElementSelectionEvent({
        ...commit,
        payload: { ...commit.payload, rect: { x: 20, y: 30, width: 0, height: 80 } },
      }),
    ).toMatchObject({ ok: false, error: { code: "E_PROTOCOL_MESSAGE" } });
  });

  it("parses matching open and validated responses", () => {
    const opened = ElementSelectionOpenedMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "open-1",
      source: "content",
      target: "background",
      type: "ELEMENT_SELECTION_OPENED",
      payload: { jobId: "job-1", reused: false },
      sentAt,
    });
    expect(parseElementSelectionOpenResponse(opened, "open-1")).toEqual({
      ok: true,
      value: opened,
    });

    const validated = ElementTargetValidatedMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "validate-1",
      source: "content",
      target: "background",
      type: "ELEMENT_TARGET_VALIDATED",
      payload: {
        jobId: "job-1",
        descriptor,
        rect: { x: 40, y: 50, width: 300, height: 100 },
      },
      sentAt,
    });
    expect(parseElementTargetRevalidateResponse(validated, "validate-1")).toEqual({
      ok: true,
      value: validated,
    });
  });

  it("preserves normalized stale-target errors from content", () => {
    const stale = ElementSelectionErrorMessageSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "validate-1",
      source: "content",
      target: "background",
      type: "ELEMENT_SELECTION_ERROR",
      payload: {
        code: "E_TARGET_STALE",
        stage: "capture",
        message: "The selected element no longer exists on the page.",
        userMessageKey: "errors.targetStale",
        retryable: true,
        fallbackAllowed: false,
        causeCode: "ElementTargetDisconnected",
      },
      sentAt,
    });
    expect(parseElementTargetRevalidateResponse(stale, "validate-1")).toMatchObject({
      ok: false,
      error: { code: "E_TARGET_STALE", causeCode: "ElementTargetDisconnected" },
    });
  });
});
