import { describe, expect, it } from "vitest";

import { routeRuntimeMessage } from "@background/message-router";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import type { VisibleCaptureCoordinatorPort } from "@background/visible-capture-coordinator";
import { FOUNDATION_CAPABILITIES } from "@shared/capabilities";
import {
  PROTOCOL_VERSION,
  createCapabilitiesGetMessage,
  createPingMessage,
  createTabCapabilityGetMessage,
  createVisibleCaptureCancelMessage,
  createVisibleCaptureStartMessage,
} from "@shared/contracts/messages";

const now = new Date("2026-08-02T09:00:00.020Z");
const tabs: TabsCaptureAdapter = {
  queryActiveTab: async () => ({ id: 7, windowId: 9, active: true, url: "https://example.com" }),
  captureVisibleTab: async () => "unused",
};
const visibleCapture: VisibleCaptureCoordinatorPort = {
  start: async () => ({
    captureId: "capture-1",
    tabId: 7,
    windowId: 9,
    mimeType: "image/png",
    byteLength: 68,
    width: 1,
    height: 1,
  }),
  cancel: () => true,
};
const dependencies = {
  workerVersion: "0.1.0",
  capabilities: FOUNDATION_CAPABILITIES,
  tabs,
  visibleCapture,
  now: () => now,
};

describe("routeRuntimeMessage", () => {
  it("returns a pong for a valid ping", async () => {
    const response = await routeRuntimeMessage(
      createPingMessage({
        requestId: "request-123",
        clientVersion: "0.1.0",
        sentAt: "2026-08-02T09:00:00.000Z",
      }),
      dependencies,
    );

    expect(response).toMatchObject({
      requestId: "request-123",
      type: "PONG",
      payload: { workerVersion: "0.1.0" },
      sentAt: now.toISOString(),
    });
  });

  it("returns current capabilities", async () => {
    const response = await routeRuntimeMessage(
      createCapabilitiesGetMessage({
        requestId: "request-124",
        sentAt: "2026-08-02T09:00:00.000Z",
      }),
      dependencies,
    );

    expect(response).toMatchObject({
      type: "CAPABILITIES_RESPONSE",
      payload: FOUNDATION_CAPABILITIES,
    });
  });

  it("reports active-tab capability without a full URL", async () => {
    const response = await routeRuntimeMessage(
      createTabCapabilityGetMessage({
        requestId: "request-tab",
        sentAt: "2026-08-02T09:00:00.000Z",
      }),
      dependencies,
    );

    expect(response).toMatchObject({
      type: "TAB_CAPABILITY_RESPONSE",
      payload: { status: "supported", tabId: 7, windowId: 9, scheme: "https" },
    });
    expect(JSON.stringify(response)).not.toContain("example.com");
  });

  it("routes visible capture start and cancellation", async () => {
    const capture = await routeRuntimeMessage(
      createVisibleCaptureStartMessage({
        requestId: "request-capture",
        sentAt: "2026-08-02T09:00:00.000Z",
      }),
      dependencies,
    );
    expect(capture).toMatchObject({
      type: "VISIBLE_CAPTURE_SUCCESS",
      payload: { captureId: "capture-1", mimeType: "image/png" },
    });

    const cancelled = await routeRuntimeMessage(
      createVisibleCaptureCancelMessage({
        requestId: "request-cancel",
        captureRequestId: "request-capture",
        sentAt: "2026-08-02T09:00:00.000Z",
      }),
      dependencies,
    );
    expect(cancelled).toMatchObject({
      type: "VISIBLE_CAPTURE_CANCELLED",
      payload: { captureRequestId: "request-capture", accepted: true },
    });
  });

  it("returns a normalized protocol error for addressed invalid messages", async () => {
    const response = await routeRuntimeMessage(
      {
        protocolVersion: PROTOCOL_VERSION + 1,
        requestId: "request-125",
        source: "popup",
        target: "background",
        type: "PING",
        payload: {},
        sentAt: "2026-08-02T09:00:00.000Z",
      },
      dependencies,
    );

    expect(response).toMatchObject({
      type: "ERROR_RESPONSE",
      payload: { code: "E_PROTOCOL_VERSION", stage: "protocol" },
    });
  });

  it("ignores messages not addressed to the background", async () => {
    await expect(routeRuntimeMessage({ type: "UNKNOWN" }, dependencies)).resolves.toBeUndefined();
  });
});
