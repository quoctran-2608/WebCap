import { describe, expect, it, vi } from "vitest";

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
  createVisibleSessionGetMessage,
} from "@shared/contracts/messages";
import {
  createJobResumeMessage,
  createPdfManifestGetMessage,
} from "@shared/contracts/job-messages";
import type { VisibleSessionSnapshot } from "@shared/contracts/visible-session";
import type { VisibleSessionRepositoryPort } from "@storage/visible-session-repository";

const now = new Date("2026-08-02T09:00:00.020Z");
const tabs: TabsCaptureAdapter = {
  queryActiveTab: () =>
    Promise.resolve({ id: 7, windowId: 9, active: true, url: "https://example.com" }),
  captureVisibleTab: () => Promise.resolve("unused"),
};

function createSessionRepository(): {
  repository: VisibleSessionRepositoryPort;
  getSnapshot: () => VisibleSessionSnapshot | undefined;
} {
  let snapshot: VisibleSessionSnapshot | undefined;
  return {
    getSnapshot: () => snapshot,
    repository: {
      load: () => Promise.resolve(snapshot),
      save: (next) => {
        snapshot = next;
        return Promise.resolve();
      },
      clear: () => {
        snapshot = undefined;
        return Promise.resolve();
      },
    },
  };
}

function createDependencies() {
  const start = vi.fn(() =>
    Promise.resolve({
      captureId: "capture-1",
      tabId: 7,
      windowId: 9,
      mimeType: "image/png" as const,
      byteLength: 68,
      width: 1,
      height: 1,
    }),
  );
  const cancel = vi.fn(() => true);
  const waitForIdle = vi.fn(() => Promise.resolve());
  const releaseCapture = vi.fn(() => true);
  const visibleCapture: VisibleCaptureCoordinatorPort = {
    start,
    cancel,
    waitForIdle,
    releaseCapture,
  };
  const exportCapture = vi.fn(
    (options: Parameters<ImageExportCoordinatorPort["exportCapture"]>[0]) =>
      Promise.resolve({
        artifactId: `artifact-${options.format}`,
        sourceArtifactId: options.sourceArtifactId,
        format: options.format,
        mimeType:
          options.format === "jpeg"
            ? ("image/jpeg" as const)
            : options.format === "webp"
              ? ("image/webp" as const)
              : ("image/png" as const),
        filename: `capture.${options.format}`,
        byteLength: 64,
        width: 1,
        height: 1,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 1_000).toISOString(),
      }),
  );
  const downloadArtifact = vi.fn(() => Promise.resolve(77));
  const cancelBySourceArtifactId = vi.fn(() => Promise.resolve());
  const imageExport: ImageExportCoordinatorPort = {
    exportCapture,
    downloadArtifact,
    cancelBySourceArtifactId,
  };
  const session = createSessionRepository();

  return {
    session,
    start,
    cancel,
    exportCapture,
    downloadArtifact,
    dependencies: {
      workerVersion: "0.1.0",
      capabilities: FOUNDATION_CAPABILITIES,
      tabs,
      visibleCapture,
      imageExport,
      visibleSessions: session.repository,
      now: () => now,
    },
  };
}

describe("routeRuntimeMessage", () => {
  it("returns a pong and current capabilities", async () => {
    const { dependencies } = createDependencies();
    const pong = await routeRuntimeMessage(
      createPingMessage({
        requestId: "request-123",
        clientVersion: "0.1.0",
        sentAt: "2026-08-02T09:00:00.000Z",
      }),
      dependencies,
    );
    expect(pong).toMatchObject({
      requestId: "request-123",
      type: "PONG",
      payload: { workerVersion: "0.1.0" },
    });

    const capabilities = await routeRuntimeMessage(
      createCapabilitiesGetMessage({
        requestId: "request-124",
        sentAt: "2026-08-02T09:00:00.000Z",
      }),
      dependencies,
    );
    expect(capabilities).toMatchObject({
      type: "CAPABILITIES_RESPONSE",
      payload: FOUNDATION_CAPABILITIES,
    });
  });

  it("reports active-tab capability without a full URL", async () => {
    const { dependencies } = createDependencies();
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

  it("persists capture, preview, reopen, and download status without binary data", async () => {
    const { dependencies, session, start, exportCapture, downloadArtifact } = createDependencies();

    await routeRuntimeMessage(
      createVisibleCaptureStartMessage({
        requestId: "request-capture",
        outputFormat: "webp",
        quality: 0.85,
        sentAt: now.toISOString(),
      }),
      dependencies,
    );
    expect(session.getSnapshot()).toMatchObject({
      status: "captured",
      format: "webp",
      quality: 0.85,
      source: { captureId: "capture-1" },
    });

    const restored = await routeRuntimeMessage(
      createVisibleSessionGetMessage({
        requestId: "request-session",
        sentAt: now.toISOString(),
      }),
      dependencies,
    );
    expect(restored).toMatchObject({
      type: "VISIBLE_SESSION_RESPONSE",
      payload: { session: { status: "captured", source: { captureId: "capture-1" } } },
    });

    await routeRuntimeMessage(
      createImageExportStartMessage({
        requestId: "request-export",
        sourceArtifactId: "capture-1",
        format: "webp",
        quality: 0.85,
        sentAt: now.toISOString(),
      }),
      dependencies,
    );
    expect(session.getSnapshot()).toMatchObject({
      status: "ready",
      artifact: { artifactId: "artifact-webp", format: "webp" },
    });

    await routeRuntimeMessage(
      createArtifactDownloadStartMessage({
        requestId: "request-download",
        artifactId: "artifact-webp",
        sentAt: now.toISOString(),
      }),
      dependencies,
    );
    expect(session.getSnapshot()).toMatchObject({
      status: "completed",
      downloadId: 77,
    });
    expect(JSON.stringify(session.getSnapshot())).not.toContain("blob");
    expect(start).toHaveBeenCalledTimes(1);
    expect(exportCapture).toHaveBeenCalledTimes(1);
    expect(downloadArtifact).toHaveBeenCalledTimes(1);
  });

  it("re-exports from a stored source without recapturing", async () => {
    const { dependencies, start, exportCapture } = createDependencies();

    await routeRuntimeMessage(
      createVisibleCaptureStartMessage({
        requestId: "request-capture",
        outputFormat: "png",
        quality: 0.92,
        sentAt: now.toISOString(),
      }),
      dependencies,
    );
    await routeRuntimeMessage(
      createImageExportStartMessage({
        requestId: "request-export-png",
        sourceArtifactId: "capture-1",
        format: "png",
        quality: 0.92,
        sentAt: now.toISOString(),
      }),
      dependencies,
    );
    await routeRuntimeMessage(
      createImageExportStartMessage({
        requestId: "request-export-jpeg",
        sourceArtifactId: "capture-1",
        format: "jpeg",
        quality: 0.8,
        sentAt: now.toISOString(),
      }),
      dependencies,
    );

    expect(start).toHaveBeenCalledTimes(1);
    expect(exportCapture).toHaveBeenCalledTimes(2);
  });

  it("routes cancellation and persists cancelled status", async () => {
    const { dependencies, session, cancel } = createDependencies();

    await routeRuntimeMessage(
      createVisibleCaptureStartMessage({
        requestId: "request-capture",
        sentAt: now.toISOString(),
      }),
      dependencies,
    );
    const response = await routeRuntimeMessage(
      createVisibleCaptureCancelMessage({
        requestId: "request-cancel",
        captureRequestId: "request-capture",
        sentAt: now.toISOString(),
      }),
      dependencies,
    );

    expect(response).toMatchObject({
      type: "VISIBLE_CAPTURE_CANCELLED",
      payload: { accepted: true },
    });
    expect(cancel).toHaveBeenCalledWith("request-capture");
    expect(session.getSnapshot()).toMatchObject({ status: "cancelled" });
  });

  it("leaves S35 PDF UX messages to the dedicated router", async () => {
    const { dependencies } = createDependencies();
    await expect(
      routeRuntimeMessage(
        createPdfManifestGetMessage({
          requestId: "request-pdf-manifest",
          jobId: "job-s35",
          sentAt: now.toISOString(),
        }),
        dependencies,
      ),
    ).resolves.toBeUndefined();
    await expect(
      routeRuntimeMessage(
        createJobResumeMessage({
          requestId: "request-pdf-resume",
          jobId: "job-s35",
          sentAt: now.toISOString(),
        }),
        dependencies,
      ),
    ).resolves.toBeUndefined();
  });

  it("returns a normalized protocol error for addressed invalid messages", async () => {
    const { dependencies } = createDependencies();
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
    const { dependencies } = createDependencies();
    await expect(routeRuntimeMessage({ type: "UNKNOWN" }, dependencies)).resolves.toBeUndefined();
  });
});
