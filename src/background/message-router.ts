import { FOUNDATION_CAPABILITIES, type CaptureCapabilities } from "@shared/capabilities";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import {
  createArtifactDownloadStartedMessage,
  createCapabilitiesResponseMessage,
  createErrorResponseMessage,
  createImageExportSuccessMessage,
  createPongMessage,
  createTabCapabilityResponseMessage,
  createVisibleCaptureCancelledMessage,
  createVisibleCaptureSuccessMessage,
  parseBackgroundRequest,
  type BackgroundResponse,
} from "@shared/contracts/messages";
import { normalizeError } from "@shared/errors/normalize-error";
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";

import { createChromeTabsAdapter, type TabsCaptureAdapter } from "./chrome-tabs-adapter";
import { DownloadService } from "./download-service";
import { ImageExportService } from "./image-export-service";
import { OffscreenService } from "./offscreen-service";
import { inspectActiveTab } from "./tab-capability";
import {
  VisibleCaptureCoordinator,
  type VisibleCaptureCoordinatorPort,
} from "./visible-capture-coordinator";

export interface ImageExportCoordinatorPort {
  exportCapture(options: {
    requestId: string;
    sourceArtifactId: string;
    format: "png" | "jpeg" | "webp";
    quality: number;
  }): Promise<ArtifactMetadata>;
  downloadArtifact(artifactId: string): Promise<number>;
}

export interface MessageRouterDependencies {
  workerVersion: string;
  capabilities: CaptureCapabilities;
  tabs: TabsCaptureAdapter;
  visibleCapture: VisibleCaptureCoordinatorPort;
  imageExport: ImageExportCoordinatorPort;
  now: () => Date;
}

let sharedDependencies: MessageRouterDependencies | undefined;

function defaultDependencies(): MessageRouterDependencies {
  if (sharedDependencies !== undefined) {
    return sharedDependencies;
  }

  const tabs = createChromeTabsAdapter();
  const artifacts = new IndexedDbArtifactRepository();
  const offscreen = new OffscreenService();
  const downloads = new DownloadService({ artifacts, objectUrls: offscreen });
  const imageExport = new ImageExportService({ artifacts, offscreen, downloads });
  sharedDependencies = {
    workerVersion: chrome.runtime.getManifest().version,
    capabilities: FOUNDATION_CAPABILITIES,
    tabs,
    visibleCapture: new VisibleCaptureCoordinator({ tabs, artifacts }),
    imageExport,
    now: () => new Date(),
  };
  void artifacts.deleteExpired(new Date().toISOString()).catch(() => undefined);
  return sharedDependencies;
}

function requestIdFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("requestId" in value)) {
    return undefined;
  }

  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}

function targetsBackground(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "target" in value &&
    (value as { target?: unknown }).target === "background"
  );
}

export async function routeRuntimeMessage(
  message: unknown,
  dependencies: MessageRouterDependencies,
): Promise<BackgroundResponse | undefined> {
  const parsed = parseBackgroundRequest(message);
  if (!parsed.ok) {
    const requestId = requestIdFrom(message);
    if (requestId === undefined || !targetsBackground(message)) {
      return undefined;
    }

    return createErrorResponseMessage({
      requestId,
      error: parsed.error,
      sentAt: dependencies.now().toISOString(),
    });
  }

  try {
    switch (parsed.value.type) {
      case "PING":
        return createPongMessage({
          requestId: parsed.value.requestId,
          workerVersion: dependencies.workerVersion,
          requestSentAt: parsed.value.sentAt,
          sentAt: dependencies.now().toISOString(),
        });
      case "CAPABILITIES_GET":
        return createCapabilitiesResponseMessage({
          requestId: parsed.value.requestId,
          capabilities: dependencies.capabilities,
          sentAt: dependencies.now().toISOString(),
        });
      case "TAB_CAPABILITY_GET":
        return createTabCapabilityResponseMessage({
          requestId: parsed.value.requestId,
          capability: await inspectActiveTab(dependencies.tabs),
          sentAt: dependencies.now().toISOString(),
        });
      case "VISIBLE_CAPTURE_START":
        return createVisibleCaptureSuccessMessage({
          requestId: parsed.value.requestId,
          metadata: await dependencies.visibleCapture.start(parsed.value.requestId),
          sentAt: dependencies.now().toISOString(),
        });
      case "VISIBLE_CAPTURE_CANCEL":
        return createVisibleCaptureCancelledMessage({
          requestId: parsed.value.requestId,
          captureRequestId: parsed.value.payload.captureRequestId,
          accepted: dependencies.visibleCapture.cancel(parsed.value.payload.captureRequestId),
          sentAt: dependencies.now().toISOString(),
        });
      case "IMAGE_EXPORT_START":
        return createImageExportSuccessMessage({
          requestId: parsed.value.requestId,
          artifact: await dependencies.imageExport.exportCapture({
            requestId: parsed.value.requestId,
            sourceArtifactId: parsed.value.payload.sourceArtifactId,
            format: parsed.value.payload.format,
            quality: parsed.value.payload.quality,
          }),
          sentAt: dependencies.now().toISOString(),
        });
      case "ARTIFACT_DOWNLOAD_START":
        return createArtifactDownloadStartedMessage({
          requestId: parsed.value.requestId,
          artifactId: parsed.value.payload.artifactId,
          downloadId: await dependencies.imageExport.downloadArtifact(
            parsed.value.payload.artifactId,
          ),
          sentAt: dependencies.now().toISOString(),
        });
    }
  } catch (error) {
    return createErrorResponseMessage({
      requestId: parsed.value.requestId,
      error: normalizeError(error, {
        stage:
          parsed.value.type === "ARTIFACT_DOWNLOAD_START"
            ? "export"
            : parsed.value.type === "IMAGE_EXPORT_START"
              ? "process"
              : "capture",
        userMessageKey:
          parsed.value.type === "ARTIFACT_DOWNLOAD_START"
            ? "errors.downloadFailed"
            : parsed.value.type === "IMAGE_EXPORT_START"
              ? "errors.exportFailed"
              : "errors.captureFailed",
        retryable: true,
        fallbackAllowed: false,
      }),
      sentAt: dependencies.now().toISOString(),
    });
  }
}

export function registerMessageRouter(): void {
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (!targetsBackground(message)) {
        return false;
      }

      void routeRuntimeMessage(message, defaultDependencies()).then((response) => {
        if (response !== undefined) {
          sendResponse(response);
        }
      });
      return true;
    },
  );
}
