import { describe, expect, it } from "vitest";

import {
  createPingMessage,
  createPongMessage,
  isPingMessage,
  isPongMessage,
  PROTOCOL_VERSION,
} from "@shared/contracts/handshake";

const requestId = "request-123";
const sentAt = "2026-08-02T09:00:00.000Z";

describe("handshake contract", () => {
  it("creates a typed ping envelope", () => {
    const message = createPingMessage({
      requestId,
      clientVersion: "0.1.0",
      sentAt,
    });

    expect(message).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      source: "popup",
      target: "background",
      type: "PING",
      payload: {
        client: "webcap-popup",
        clientVersion: "0.1.0",
      },
      sentAt,
    });
    expect(isPingMessage(message)).toBe(true);
  });

  it("creates a matching pong envelope", () => {
    const message = createPongMessage({
      requestId,
      workerVersion: "0.1.0",
      requestSentAt: sentAt,
      sentAt: "2026-08-02T09:00:00.010Z",
    });

    expect(isPongMessage(message)).toBe(true);
    expect(message.payload.requestSentAt).toBe(sentAt);
  });

  it("rejects a message with an unknown protocol version", () => {
    expect(
      isPingMessage({
        ...createPingMessage({ requestId, clientVersion: "0.1.0", sentAt }),
        protocolVersion: 2,
      }),
    ).toBe(false);
  });

  it("rejects malformed payloads", () => {
    expect(
      isPongMessage({
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        source: "background",
        target: "popup",
        type: "PONG",
        payload: null,
        sentAt,
      }),
    ).toBe(false);
  });
});
