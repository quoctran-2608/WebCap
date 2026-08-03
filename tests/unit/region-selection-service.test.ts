import { describe, expect, it, vi } from "vitest";

import {
  RegionSelectionService,
  type RegionSelectionBrowserAdapter,
} from "@background/region-selection-service";
import { PROTOCOL_VERSION } from "@shared/constants";

const now = new Date("2026-08-03T08:00:00.000Z");

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
  it("injects the shared content runtime and opens the selector", async () => {
    const current = adapter({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "request-1",
      source: "content",
      target: "background",
      type: "REGION_SELECTION_OPENED",
      payload: { jobId: "job-1", reused: false },
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

  it("throws normalized content-protocol failures", async () => {
    const current = adapter({ type: "invalid" });
    const service = new RegionSelectionService(
      current.browser,
      () => now,
      () => "request-2",
    );

    await expect(service.start(7, "job-1")).rejects.toMatchObject({
      name: "E_PROTOCOL_MESSAGE",
    });
  });
});
