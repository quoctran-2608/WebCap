import { describe, expect, it } from "vitest";

import { FOUNDATION_CAPABILITIES } from "@shared/capabilities";
import {
  createCapabilitiesResponseMessage,
  isCapabilitiesResponseMessage,
} from "@shared/contracts/messages";
import { getCapabilities, type RuntimeMessenger } from "@popup/worker-client";

const now = new Date("2026-08-02T09:00:00.000Z");

function createRuntime(respond: (message: unknown) => Promise<unknown>): RuntimeMessenger {
  return {
    getVersion: () => "0.1.0",
    sendMessage: respond,
  };
}

describe("getCapabilities", () => {
  it("returns a validated capability response", async () => {
    const result = await getCapabilities({
      runtime: createRuntime((message) => {
        const request = message as { requestId: string };
        return Promise.resolve(
          createCapabilitiesResponseMessage({
            requestId: request.requestId,
            capabilities: FOUNDATION_CAPABILITIES,
            sentAt: now.toISOString(),
          }),
        );
      }),
      now: () => now,
      requestId: () => "request-capabilities",
      timeoutMs: 100,
    });

    expect(result).toEqual(FOUNDATION_CAPABILITIES);
  });

  it("rejects malformed capability responses", async () => {
    const malformed = {
      protocolVersion: 1,
      requestId: "request-capabilities",
      source: "background",
      target: "popup",
      type: "CAPABILITIES_RESPONSE",
      payload: { settings: true },
      sentAt: now.toISOString(),
    };
    expect(isCapabilitiesResponseMessage(malformed)).toBe(false);

    await expect(
      getCapabilities({
        runtime: createRuntime(() => Promise.resolve(malformed)),
        now: () => now,
        requestId: () => "request-capabilities",
        timeoutMs: 100,
      }),
    ).rejects.toThrow("invalid capabilities");
  });
});
