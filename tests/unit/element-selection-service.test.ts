import { describe, expect, it, vi } from "vitest";

import {
  ElementSelectionService,
  type ElementSelectionBrowserAdapter,
} from "@background/element-selection-service";
import { PROTOCOL_VERSION } from "@shared/constants";
import type { CaptureJob } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const now = new Date("2026-08-03T09:00:00.000Z");
const descriptor = {
  schemaVersion: 1 as const,
  selectionId: "selection-1",
  tagName: "section",
  classNames: ["capture-card"],
  scrollable: false,
  captureKind: "visible-bounds" as const,
};

function elementJob(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { createdAt: now.toISOString() },
    mode: "element",
    preferredEngine: "cdp",
    state: "preparing",
    stateRevision: 1,
    targetRect: { x: 20, y: 30, width: 200, height: 80 },
    targetDescriptor: descriptor,
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

function adapter(responses: unknown[]): {
  browser: ElementSelectionBrowserAdapter;
  inject: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const inject = vi.fn(() => Promise.resolve());
  const send = vi.fn(() => Promise.resolve(responses.shift()));
  return { browser: { injectContentScript: inject, sendMessage: send }, inject, send };
}

describe("ElementSelectionService", () => {
  it("injects the content runtime and opens the selector", async () => {
    const current = adapter([
      {
        protocolVersion: PROTOCOL_VERSION,
        requestId: "request-1",
        source: "content",
        target: "background",
        type: "ELEMENT_SELECTION_OPENED",
        payload: { jobId: "job-1", reused: false },
        sentAt: now.toISOString(),
      },
    ]);
    const service = new ElementSelectionService(
      current.browser,
      () => now,
      () => "request-1",
    );

    await service.start(7, "job-1");

    expect(current.inject).toHaveBeenCalledWith(7);
    expect(current.send).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: "ELEMENT_SELECTION_OPEN", payload: { jobId: "job-1" } }),
    );
  });

  it("revalidates the opaque identity and returns current document bounds", async () => {
    const current = adapter([
      {
        protocolVersion: PROTOCOL_VERSION,
        requestId: "validate-1",
        source: "content",
        target: "background",
        type: "ELEMENT_TARGET_VALIDATED",
        payload: {
          jobId: "job-1",
          descriptor,
          rect: { x: 90, y: 120, width: 260, height: 110 },
        },
        sentAt: now.toISOString(),
      },
    ]);
    const service = new ElementSelectionService(
      current.browser,
      () => now,
      () => "validate-1",
    );

    await expect(service.revalidate(elementJob())).resolves.toEqual({
      x: 90,
      y: 120,
      width: 260,
      height: 110,
    });
    expect(current.send).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: "ELEMENT_TARGET_REVALIDATE",
        payload: { jobId: "job-1", descriptor },
      }),
    );
  });

  it("propagates E_TARGET_STALE without substituting another node", async () => {
    const current = adapter([
      {
        protocolVersion: PROTOCOL_VERSION,
        requestId: "validate-stale",
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
        sentAt: now.toISOString(),
      },
    ]);
    const service = new ElementSelectionService(
      current.browser,
      () => now,
      () => "validate-stale",
    );

    await expect(service.revalidate(elementJob())).rejects.toMatchObject({
      name: "E_TARGET_STALE",
      data: { causeCode: "ElementTargetDisconnected" },
    });
  });
});
