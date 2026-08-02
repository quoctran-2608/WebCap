import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  createCapabilitiesGetMessage,
  parseBackgroundRequest,
} from "@shared/contracts/messages";

describe("runtime message schemas", () => {
  it("parses a valid capabilities request", () => {
    const request = createCapabilitiesGetMessage({
      requestId: "request-1",
      sentAt: "2026-08-02T09:00:00.000Z",
    });

    expect(parseBackgroundRequest(request)).toEqual({ ok: true, value: request });
  });

  it("distinguishes protocol-version and message-shape failures", () => {
    const wrongVersion = parseBackgroundRequest({
      protocolVersion: 2,
      requestId: "request-1",
      source: "popup",
      target: "background",
      type: "PING",
      payload: {},
      sentAt: "2026-08-02T09:00:00.000Z",
    });
    const wrongShape = parseBackgroundRequest({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "request-1",
      source: "popup",
      target: "background",
      type: "PING",
      payload: {},
      sentAt: "2026-08-02T09:00:00.000Z",
    });

    expect(wrongVersion).toMatchObject({ ok: false, error: { code: "E_PROTOCOL_VERSION" } });
    expect(wrongShape).toMatchObject({ ok: false, error: { code: "E_PROTOCOL_MESSAGE" } });
  });
});
