import { describe, expect, it } from "vitest";

import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import { evaluateTab, requireCapturableTab } from "@background/tab-capability";

const adapterWithUrl = (url: string): TabsCaptureAdapter => ({
  queryActiveTab: async () => ({ id: 7, windowId: 9, active: true, url }),
  captureVisibleTab: async () => "unused",
});

describe("tab capability", () => {
  it("supports ordinary web and file URLs without returning the full URL", () => {
    expect(
      evaluateTab({ id: 7, windowId: 9, active: true, url: "https://example.com/path" }),
    ).toEqual({
      status: "supported",
      tabId: 7,
      windowId: 9,
      scheme: "https",
    });
    expect(
      evaluateTab({ id: 8, windowId: 9, active: true, url: "file:///tmp/page.html" }),
    ).toMatchObject({
      status: "supported",
      scheme: "file",
    });
  });

  it("rejects internal Chrome URLs", async () => {
    expect(evaluateTab({ id: 7, windowId: 9, active: true, url: "chrome://settings" })).toEqual({
      status: "unsupported",
      tabId: 7,
      windowId: 9,
      scheme: "chrome",
      errorCode: "E_UNSUPPORTED_URL",
    });

    const result = await requireCapturableTab(adapterWithUrl("chrome://settings"));
    expect(result).toMatchObject({ ok: false, error: { code: "E_UNSUPPORTED_URL" } });
  });

  it("normalizes a missing active tab", async () => {
    const adapter: TabsCaptureAdapter = {
      queryActiveTab: async () => undefined,
      captureVisibleTab: async () => "unused",
    };

    expect(await requireCapturableTab(adapter)).toMatchObject({
      ok: false,
      error: { code: "E_TAB_NOT_ACTIVE", retryable: true },
    });
  });
});
