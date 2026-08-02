import { describe, expect, it } from "vitest";

import { routeRuntimeMessage } from "@background/message-router";
import { FOUNDATION_CAPABILITIES } from "@shared/capabilities";
import {
  PROTOCOL_VERSION,
  createCapabilitiesGetMessage,
  createPingMessage,
} from "@shared/contracts/messages";

const now = new Date("2026-08-02T09:00:00.020Z");
const dependencies = {
  workerVersion: "0.1.0",
  capabilities: FOUNDATION_CAPABILITIES,
  now: () => now,
};

describe("routeRuntimeMessage", () => {
  it("returns a pong for a valid ping", () => {
    const response = routeRuntimeMessage(
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

  it("returns current capabilities", () => {
    const response = routeRuntimeMessage(
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

  it("returns a normalized protocol error for addressed invalid messages", () => {
    const response = routeRuntimeMessage(
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

  it("ignores messages not addressed to the background", () => {
    expect(routeRuntimeMessage({ type: "UNKNOWN" }, dependencies)).toBeUndefined();
  });
});
