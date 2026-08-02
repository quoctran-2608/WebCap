import { describe, expect, it } from "vitest";

import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import { routeRuntimeMessage, type ImageExportCoordinatorPort } from "@background/message-router";
import type { VisibleCaptureCoordinatorPort } from "@background/visible-capture-coordinator";
import { FOUNDATION_CAPABILITIES } from "@shared/capabilities";
import {
  PROTOCOL_VERSION,
  createArtifactDownloadStartMessage,
  createCapabilitiesGetMessage,
  createImageExportStartMessage,
  createPingMessage,
  createTabCapabilityGetMessage,
  createVisibleCaptureCancelMessage,
  createVisibleCaptureStartMessage,
} from "@shared/contracts/messages";

const now = new Date("2026-08-02T09:00:00.020Z");
const tabs: TabsCaptureAdapter = {
  queryActiveTab: () =>
    Promise.resolve({ id: 7, windowId: 9, active: true, url: "https://example.com" }),
  captureVisibleTab: () => Promise.resolve("unused"),
};
const visibleCapture: VisibleCaptureCoordinatorPort = {
  start: () =>
    Promise.resolve({
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
const imageExport: ImageExportCoordinatorPort = {
  exportCapture: (options) =>
    Promise.resolve({
      artifactId: "artifact-1",
      sourceArtifactId: options.sourceArtifactId,
      format: options.format,
      mimeType: options.format === "jpeg" ? "image/jpeg" : "image/png",
      filename: "capture.jpg",
      byteLength: 64,
      width: 1,
      height: 1,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 1_000).toISOString(),
    }),
  downloadArtifact: () => Promise.resolve(77),
};
const dependencies = {
  workerVersion: "0.1.0",
  capabilities: FOUNDATION_CAPABILITIES,
  tabs,
  visibleCapture,
  imageExport,
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

  it("routes image processing and artifact download without recapture", async () => {
    const exported = await routeRuntimeMessage(
      createImageExportStartMessage({
        requestId: "request-export",
        sourceArtifactId: "capture-1",
        format: "jpeg",
        quality: 0.9,
        sentAt: now.toISOString(),
      }),
      dependencies,
    );
    expect(exported).toMatchObject({
      type: "IMAGE_EXPORT_SUCCESS",
      payload: { artifactId: "artifact-1", sourceArtifactId: "capture-1" },
    });

    const downloaded = await routeRuntimeMessage(
      createArtifactDownloadStartMessage({
        requestId: "request-download",
        artifactId: "artifact-1",
        sentAt: now.toISOString(),
      }),
      dependencies,
    );
    expect(downloaded).toMatchObject({
      type: "ARTIFACT_DOWNLOAD_STARTED",
      payload: { artifactId: "artifact-1", downloadId: 77 },
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
