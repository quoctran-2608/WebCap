import { describe, expect, it } from "vitest";

import { pingWorker, type RuntimeMessenger } from "@popup/worker-client";
import { createPongMessage, isPingMessage } from "@shared/contracts/handshake";

const now = new Date("2026-08-02T09:00:00.000Z");

function createRuntime(
  respond: (message: unknown) => Promise<unknown>,
): RuntimeMessenger {
  return {
    getVersion: () => "0.1.0",
    sendMessage: respond,
  };
}

describe("pingWorker", () => {
  it("accepts a matching pong response", async () => {
    const response = await pingWorker({
      runtime: createRuntime((message) => {
        expect(isPingMessage(message)).toBe(true);

        if (!isPingMessage(message)) {
          return Promise.reject(new Error("Expected a ping message."));
        }

        return Promise.resolve(
          createPongMessage({
            requestId: message.requestId,
            workerVersion: "0.1.0",
            requestSentAt: message.sentAt,
            sentAt: now.toISOString(),
          }),
        );
      }),
      now: () => now,
      requestId: () => "request-123",
      timeoutMs: 100,
    });

    expect(response.payload.workerVersion).toBe("0.1.0");
  });

  it("rejects a response with a different request id", async () => {
    await expect(
      pingWorker({
        runtime: createRuntime(() =>
          Promise.resolve(
            createPongMessage({
              requestId: "different-request",
              workerVersion: "0.1.0",
              requestSentAt: now.toISOString(),
              sentAt: now.toISOString(),
            }),
          ),
        ),
        now: () => now,
        requestId: () => "request-123",
        timeoutMs: 100,
      }),
    ).rejects.toThrow("did not match");
  });

  it("rejects an invalid response", async () => {
    await expect(
      pingWorker({
        runtime: createRuntime(() => Promise.resolve({ type: "NOT_PONG" })),
        now: () => now,
        requestId: () => "request-123",
        timeoutMs: 100,
      }),
    ).rejects.toThrow(TypeError);
  });
});
