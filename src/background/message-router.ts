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
  createVisibleSessionResponseMessage,
  parseBackgroundRequest,
  type BackgroundResponse,
} from "@shared/contracts/messages";
import { isOffscreenPdfExportProgressMessage } from "@shared/contracts/offscreen";
import type {
  VisibleSessionSnapshot,
  VisibleSessionStatus,
  VisibleSourceMetadata,
} from "@shared/contracts/visible-session";
import { isRegionSelectionEventType } from "@shared/contracts/region-selection";
import type { WebCapErrorData } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";
import {
  VisibleSessionRepository,
  type VisibleSessionRepositoryPort,
} from "@storage/visible-session-repository";

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
  visibleSessions?: VisibleSessionRepositoryPort;
  now: () => Date;
}

interface SessionTransitionOptions {
  status: VisibleSessionStatus;
  updatedAt: string;
  format?: VisibleSessionSnapshot["format"];
  quality?: number;
  source?: VisibleSourceMetadata | null;
  artifact?: ArtifactMetadata | null;
  downloadId?: number;
  error?: WebCapErrorData;
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
    visibleSessions: new VisibleSessionRepository(),
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

function isPersistentJobMessageType(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === "JOB_CREATE" ||
    type === "JOB_GET" ||
    type === "JOB_GET_ACTIVE" ||
    type === "JOB_CANCEL" ||
    type === "PDF_EXPORT_START"
  );
}

function targetsBackground(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "target" in value &&
    (value as { target?: unknown }).target === "background" &&
    !isPersistentJobMessageType(value) &&
    !isOffscreenPdfExportProgressMessage(value) &&
    !isRegionSelectionEventType(value)
  );
}

function transitionSession(
  session: VisibleSessionSnapshot,
  options: SessionTransitionOptions,
): VisibleSessionSnapshot {
  const source = options.source === undefined ? session.source : (options.source ?? undefined);
  const artifact =
    options.artifact === undefined ? session.artifact : (options.artifact ?? undefined);

  return {
    schemaVersion: 1,
    sessionId: session.sessionId,
    captureRequestId: session.captureRequestId,
    status: options.status,
    format: options.format ?? session.format,
    quality: options.quality ?? session.quality,
    createdAt: session.createdAt,
    updatedAt: options.updatedAt,
    ...(source === undefined ? {} : { source }),
    ...(artifact === undefined ? {} : { artifact }),
    ...(options.downloadId === undefined ? {} : { downloadId: options.downloadId }),
    ...(options.error === undefined ? {} : { error: options.error }),
  };
}

async function persistSessionFailure(
  dependencies: MessageRouterDependencies,
  error: WebCapErrorData,
): Promise<void> {
  const repository = dependencies.visibleSessions;
  if (repository === undefined) {
    return;
  }

  try {
    const session = await repository.load();
    if (session === undefined) {
      return;
    }
    await repository.save(
      transitionSession(session, {
        status: error.code === "E_CANCELLED" ? "cancelled" : "error",
        updatedAt: dependencies.now().toISOString(),
        error,
      }),
    );
  } catch {
    // Session restoration is best effort after the primary operation has already failed.
  }
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
      case "VISIBLE_SESSION_GET":
        return createVisibleSessionResponseMessage({
          requestId: parsed.value.requestId,
          session: (await dependencies.visibleSessions?.load()) ?? null,
          sentAt: dependencies.now().toISOString(),
        });
      case "VISIBLE_CAPTURE_START": {
        const createdAt = dependencies.now().toISOString();
        const session: VisibleSessionSnapshot = {
          schemaVersion: 1,
          sessionId: parsed.value.requestId,
          captureRequestId: parsed.value.requestId,
          status: "capturing",
          format: parsed.value.payload.outputFormat,
          quality: parsed.value.payload.quality,
          createdAt,
          updatedAt: createdAt,
        };
        await dependencies.visibleSessions?.save(session);

        const metadata = await dependencies.visibleCapture.start(parsed.value.requestId);
        await dependencies.visibleSessions?.save(
          transitionSession(session, {
            status: "captured",
            updatedAt: dependencies.now().toISOString(),
            source: metadata,
          }),
        );

        return createVisibleCaptureSuccessMessage({
          requestId: parsed.value.requestId,
          metadata,
          sentAt: dependencies.now().toISOString(),
        });
      }
      case "VISIBLE_CAPTURE_CANCEL": {
        const accepted = dependencies.visibleCapture.cancel(parsed.value.payload.captureRequestId);
        if (accepted && dependencies.visibleSessions !== undefined) {
          const session = await dependencies.visibleSessions.load();
          if (
            session !== undefined &&
            session.captureRequestId === parsed.value.payload.captureRequestId
          ) {
            await dependencies.visibleSessions.save(
              transitionSession(session, {
                status: "cancelled",
                updatedAt: dependencies.now().toISOString(),
              }),
            );
          }
        }

        return createVisibleCaptureCancelledMessage({
          requestId: parsed.value.requestId,
          captureRequestId: parsed.value.payload.captureRequestId,
          accepted,
          sentAt: dependencies.now().toISOString(),
        });
      }
      case "IMAGE_EXPORT_START": {
        const session = await dependencies.visibleSessions?.load();
        if (session !== undefined) {
          await dependencies.visibleSessions?.save(
            transitionSession(session, {
              status: "processing",
              updatedAt: dependencies.now().toISOString(),
              format: parsed.value.payload.format,
              quality: parsed.value.payload.quality,
              artifact: null,
            }),
          );
        }

        const artifact = await dependencies.imageExport.exportCapture({
          requestId: parsed.value.requestId,
          sourceArtifactId: parsed.value.payload.sourceArtifactId,
          format: parsed.value.payload.format,
          quality: parsed.value.payload.quality,
        });

        if (session !== undefined) {
          await dependencies.visibleSessions?.save(
            transitionSession(session, {
              status: "ready",
              updatedAt: dependencies.now().toISOString(),
              format: parsed.value.payload.format,
              quality: parsed.value.payload.quality,
              artifact,
            }),
          );
        }

        return createImageExportSuccessMessage({
          requestId: parsed.value.requestId,
          artifact,
          sentAt: dependencies.now().toISOString(),
        });
      }
      case "ARTIFACT_DOWNLOAD_START": {
        const session = await dependencies.visibleSessions?.load();
        if (session !== undefined) {
          await dependencies.visibleSessions?.save(
            transitionSession(session, {
              status: "downloading",
              updatedAt: dependencies.now().toISOString(),
            }),
          );
        }

        const downloadId = await dependencies.imageExport.downloadArtifact(
          parsed.value.payload.artifactId,
        );
        if (session !== undefined) {
          await dependencies.visibleSessions?.save(
            transitionSession(session, {
              status: "completed",
              updatedAt: dependencies.now().toISOString(),
              downloadId,
            }),
          );
        }

        return createArtifactDownloadStartedMessage({
          requestId: parsed.value.requestId,
          artifactId: parsed.value.payload.artifactId,
          downloadId,
          sentAt: dependencies.now().toISOString(),
        });
      }
    }
  } catch (error) {
    const normalized = normalizeError(error, {
      stage:
        parsed.value.type === "ARTIFACT_DOWNLOAD_START"
          ? "export"
          : parsed.value.type === "IMAGE_EXPORT_START"
            ? "process"
            : parsed.value.type === "VISIBLE_SESSION_GET"
              ? "storage"
              : "capture",
      userMessageKey:
        parsed.value.type === "ARTIFACT_DOWNLOAD_START"
          ? "errors.downloadFailed"
          : parsed.value.type === "IMAGE_EXPORT_START"
            ? "errors.exportFailed"
            : parsed.value.type === "VISIBLE_SESSION_GET"
              ? "errors.sessionRead"
              : "errors.captureFailed",
      retryable: true,
      fallbackAllowed: false,
    });
    await persistSessionFailure(dependencies, normalized);
    return createErrorResponseMessage({
      requestId: parsed.value.requestId,
      error: normalized,
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
