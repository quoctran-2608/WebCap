import { describe, expect, it } from "vitest";

import { routeRuntimeMessage } from "@background/message-router";
import { createPingMessage } from "@shared/contracts/handshake";

const now = new Date("2026-08-02T09:00:00.020Z");

describe("routeRuntimeMessage", () => {
  it("returns a pong for a valid ping", () => {
    const response = routeRuntimeMessage(
      createPingMessage({
        requestId: "request-123",
        clientVersion: "0.1.0",
        sentAt: "2026-08-02T09:00:00.000Z",
      }),
      {
        workerVersion: "0.1.0",
        now: () => now,
      },
    );

    expect(response).toMatchObject({
      requestId: "request-123",
      type: "PONG",
      source: "background",
      target: "popup",
      payload: {
        worker: "webcap-service-worker",
        workerVersion: "0.1.0",
      },
      sentAt: now.toISOString(),
    });
  });

  it("ignores unrelated messages", () => {
    expect(
      routeRuntimeMessage(
        { type: "UNKNOWN" },
        { workerVersion: "0.1.0", now: () => now },
      ),
    ).toBeUndefined();
  });
});
