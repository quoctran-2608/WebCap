import { describe, expect, it } from "vitest";

import { CaptureRateLimiter } from "@background/capture-rate-limiter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import { VisibleCaptureCoordinator } from "@background/visible-capture-coordinator";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

const immediateLimiter = (): CaptureRateLimiter =>
  new CaptureRateLimiter({
    minimumIntervalMs: 0,
    now: () => 1,
    sleep: async () => undefined,
  });

const supportedAdapter = (capture: () => Promise<string>): TabsCaptureAdapter => ({
  queryActiveTab: async () => ({ id: 7, windowId: 9, active: true, url: "https://example.com" }),
  captureVisibleTab: capture,
});

describe("VisibleCaptureCoordinator", () => {
  it("captures once, stores pixel data behind a capture ID, and returns metadata", async () => {
    let calls = 0;
    const coordinator = new VisibleCaptureCoordinator({
      tabs: supportedAdapter(async () => {
        calls += 1;
        return ONE_PIXEL_PNG;
      }),
      rateLimiter: immediateLimiter(),
      createId: () => "capture-1",
    });

    const first = await coordinator.start("request-1");
    const duplicate = await coordinator.start("request-1");

    expect(calls).toBe(1);
    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      captureId: "capture-1",
      tabId: 7,
      windowId: 9,
      mimeType: "image/png",
      width: 1,
      height: 1,
    });
    expect(coordinator.getCapture("capture-1")?.dataUrl).toBe(ONE_PIXEL_PNG);
  });

  it("deduplicates the same in-flight request", async () => {
    let resolveCapture: ((value: string) => void) | undefined;
    let calls = 0;
    const coordinator = new VisibleCaptureCoordinator({
      tabs: supportedAdapter(
        () =>
          new Promise((resolve) => {
            calls += 1;
            resolveCapture = resolve;
          }),
      ),
      rateLimiter: immediateLimiter(),
      createId: () => "capture-2",
    });

    const first = coordinator.start("request-2");
    const duplicate = coordinator.start("request-2");
    await Promise.resolve();
    await Promise.resolve();
    resolveCapture?.(ONE_PIXEL_PNG);

    await expect(Promise.all([first, duplicate])).resolves.toHaveLength(2);
    expect(calls).toBe(1);
  });

  it("rejects a different request while a capture is active", async () => {
    let resolveCapture: ((value: string) => void) | undefined;
    const coordinator = new VisibleCaptureCoordinator({
      tabs: supportedAdapter(
        () =>
          new Promise((resolve) => {
            resolveCapture = resolve;
          }),
      ),
      rateLimiter: immediateLimiter(),
      createId: () => "capture-3",
    });

    const active = coordinator.start("request-3");
    await expect(coordinator.start("request-other")).rejects.toMatchObject({
      code: "E_CAPTURE_RATE_LIMIT",
      retryable: true,
    });
    resolveCapture?.(ONE_PIXEL_PNG);
    await active;
  });

  it("honors cancellation before and after the Chrome API starts", async () => {
    const before = new VisibleCaptureCoordinator({
      tabs: supportedAdapter(async () => ONE_PIXEL_PNG),
      rateLimiter: immediateLimiter(),
    });
    expect(before.cancel("request-before")).toBe(true);
    await expect(before.start("request-before")).rejects.toMatchObject({ code: "E_CANCELLED" });

    let resolveCapture: ((value: string) => void) | undefined;
    const during = new VisibleCaptureCoordinator({
      tabs: supportedAdapter(
        () =>
          new Promise((resolve) => {
            resolveCapture = resolve;
          }),
      ),
      rateLimiter: immediateLimiter(),
      createId: () => "capture-cancelled",
    });
    const pending = during.start("request-during");
    await Promise.resolve();
    await Promise.resolve();
    expect(during.cancel("request-during")).toBe(true);
    resolveCapture?.(ONE_PIXEL_PNG);

    await expect(pending).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(during.getCapture("capture-cancelled")).toBeUndefined();
  });
});
