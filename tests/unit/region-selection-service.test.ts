import { describe, expect, it, vi } from "vitest";

import {
  RegionSelectionService,
  type RegionSelectionBrowserAdapter,
} from "@background/region-selection-service";
import { PROTOCOL_VERSION } from "@shared/constants";

const now = new Date("2026-08-05T00:30:00.000Z");
const capabilities = {
  pointerCreate: true,
  keyboardCreate: true,
  autoScroll: true,
  resizeHandles: 8,
};

function adapter(response: unknown): {
  browser: RegionSelectionBrowserAdapter;
  inject: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const inject = vi.fn(() => Promise.resolve());
  const send = vi.fn(() => Promise.resolve(response));
  return {
    browser: { injectContentScript: inject, sendMessage: send },
    inject,
    send,
  };
}

describe("RegionSelectionService", () => {
  it("waits for the focused rendered selector readiness response", async () => {
    const current = adapter({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "request-1",
      source: "content",
      target: "background",
      type: "REGION_SELECTION_OPENED",
      payload: {
        jobId: "job-1",
        selectorInstanceId: "selector-1",
        readyAt: now.toISOString(),
        reused: false,
        capabilities,
      },
      sentAt: now.toISOString(),
    });
    const service = new RegionSelectionService(
      current.browser,
      () => now,
      () => "request-1",
    );

    await service.start(7, "job-1");

    expect(current.inject).toHaveBeenCalledWith(7);
    expect(current.send).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: "REGION_SELECTION_OPEN",
        requestId: "request-1",
        payload: { jobId: "job-1" },
      }),
    );
  });

  it("rejects a selector that does not advertise every required capability", async () => {
    const current = adapter({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "request-invalid-capability",
      source: "content",
      target: "background",
      type: "REGION_SELECTION_OPENED",
      payload: {
        jobId: "job-1",
        selectorInstanceId: "selector-1",
        readyAt: now.toISOString(),
        reused: false,
        capabilities: { ...capabilities, keyboardCreate: false },
      },
      sentAt: now.toISOString(),
    });
    const service = new RegionSelectionService(
      current.browser,
      () => now,
      () => "request-invalid-capability",
    );

    await expect(service.start(7, "job-1")).rejects.toMatchObject({
      name: "E_PROTOCOL_MESSAGE",
    });
  });

  it("fails with a typed launch timeout when content never becomes ready", async () => {
    const current = adapter(new Promise(() => undefined));
    const service = new RegionSelectionService(
      current.browser,
      () => now,
      () => "request-timeout",
      5,
    );

    await expect(service.start(7, "job-1")).rejects.toMatchObject({
      name: "E_PROTOCOL_MESSAGE",
      data: { causeCode: "RegionSelectionLaunchTimeout" },
    });
  });
});
