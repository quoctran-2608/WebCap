import { describe, expect, it } from "vitest";

import {
  BackgroundRequestSchema,
  BackgroundResponseSchema,
  createArtifactDownloadStartMessage,
  createArtifactDownloadStartedMessage,
  createImageExportStartMessage,
  createImageExportSuccessMessage,
  createTabCapabilityGetMessage,
  createTabCapabilityResponseMessage,
  createVisibleCaptureCancelMessage,
  createVisibleCaptureStartMessage,
  createVisibleCaptureSuccessMessage,
  parseBackgroundRequest,
} from "@shared/contracts/messages";

const sentAt = "2026-08-02T09:00:00.000Z";
const artifact = {
  artifactId: "artifact-id",
  sourceArtifactId: "capture-id",
  format: "webp" as const,
  mimeType: "image/webp" as const,
  filename: "capture.webp",
  byteLength: 64,
  width: 1,
  height: 1,
  createdAt: sentAt,
  expiresAt: "2026-08-02T09:30:00.000Z",
};

describe("runtime message contracts", () => {
  it("validates capture, export, and download requests", () => {
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
    expect(
      BackgroundRequestSchema.safeParse(
        createImageExportStartMessage({
          requestId: "export",
          sourceArtifactId: "capture-id",
          format: "webp",
          quality: 0.9,
          sentAt,
        }),
      ).success,
    ).toBe(true);
    expect(
      BackgroundRequestSchema.safeParse(
        createArtifactDownloadStartMessage({
          requestId: "download",
          artifactId: "artifact-id",
          sentAt,
        }),
      ).success,
    ).toBe(true);
  });

  it("validates metadata-only responses", () => {
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
    expect(
      BackgroundResponseSchema.safeParse(
        createImageExportSuccessMessage({ requestId: "export", artifact, sentAt }),
      ).success,
    ).toBe(true);
    expect(
      BackgroundResponseSchema.safeParse(
        createArtifactDownloadStartedMessage({
          requestId: "download",
          artifactId: "artifact-id",
          downloadId: 4,
          sentAt,
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects binary data added to a success response", () => {
    const response = createImageExportSuccessMessage({ requestId: "export", artifact, sentAt });

    expect(
      BackgroundResponseSchema.safeParse({
        ...response,
        payload: { ...response.payload, blob: new Blob() },
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
