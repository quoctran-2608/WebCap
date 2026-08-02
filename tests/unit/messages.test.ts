import { describe, expect, it } from "vitest";

import {
  BackgroundRequestSchema,
  BackgroundResponseSchema,
  createTabCapabilityGetMessage,
  createTabCapabilityResponseMessage,
  createVisibleCaptureCancelMessage,
  createVisibleCaptureStartMessage,
  createVisibleCaptureSuccessMessage,
  parseBackgroundRequest,
} from "@shared/contracts/messages";

const sentAt = "2026-08-02T09:00:00.000Z";

describe("runtime message contracts", () => {
  it("validates S03 requests", () => {
    expect(
      BackgroundRequestSchema.safeParse(createTabCapabilityGetMessage({ requestId: "tab", sentAt }))
        .success,
    ).toBe(true);
    expect(
      BackgroundRequestSchema.safeParse(
        createVisibleCaptureStartMessage({ requestId: "capture", sentAt }),
      ).success,
    ).toBe(true);
    expect(
      BackgroundRequestSchema.safeParse(
        createVisibleCaptureCancelMessage({
          requestId: "cancel",
          captureRequestId: "capture",
          sentAt,
        }),
      ).success,
    ).toBe(true);
  });

  it("validates metadata-only S03 responses", () => {
    expect(
      BackgroundResponseSchema.safeParse(
        createTabCapabilityResponseMessage({
          requestId: "tab",
          capability: { status: "supported", tabId: 1, windowId: 2, scheme: "https" },
          sentAt,
        }),
      ).success,
    ).toBe(true);
    expect(
      BackgroundResponseSchema.safeParse(
        createVisibleCaptureSuccessMessage({
          requestId: "capture",
          metadata: {
            captureId: "capture-id",
            tabId: 1,
            windowId: 2,
            mimeType: "image/png",
            byteLength: 68,
            width: 1,
            height: 1,
          },
          sentAt,
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects binary data added to a success response", () => {
    const response = createVisibleCaptureSuccessMessage({
      requestId: "capture",
      metadata: {
        captureId: "capture-id",
        tabId: 1,
        windowId: 2,
        mimeType: "image/png",
        byteLength: 68,
        width: 1,
        height: 1,
      },
      sentAt,
    });

    expect(
      BackgroundResponseSchema.safeParse({
        ...response,
        payload: { ...response.payload, dataUrl: "data:image/png;base64,AA==" },
      }).success,
    ).toBe(false);
  });

  it("normalizes malformed requests", () => {
    expect(parseBackgroundRequest({ protocolVersion: 1 })).toMatchObject({
      ok: false,
      error: { code: "E_PROTOCOL_MESSAGE" },
    });
  });
});
