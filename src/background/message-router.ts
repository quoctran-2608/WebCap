import { FOUNDATION_CAPABILITIES, type CaptureCapabilities } from "@shared/capabilities";
import {
  createCapabilitiesResponseMessage,
  createErrorResponseMessage,
  createPongMessage,
  createTabCapabilityResponseMessage,
  createVisibleCaptureCancelledMessage,
  createVisibleCaptureSuccessMessage,
  parseBackgroundRequest,
  type BackgroundResponse,
} from "@shared/contracts/messages";
import { normalizeError } from "@shared/errors/normalize-error";

import { createChromeTabsAdapter, type TabsCaptureAdapter } from "./chrome-tabs-adapter";
import { inspectActiveTab } from "./tab-capability";
import {
  VisibleCaptureCoordinator,
  type VisibleCaptureCoordinatorPort,
} from "./visible-capture-coordinator";

export interface MessageRouterDependencies {
  workerVersion: string;
  capabilities: CaptureCapabilities;
  tabs: TabsCaptureAdapter;
  visibleCapture: VisibleCaptureCoordinatorPort;
  now: () => Date;
}

let sharedDependencies: MessageRouterDependencies | undefined;

function defaultDependencies(): MessageRouterDependencies {
  if (sharedDependencies !== undefined) {
    return sharedDependencies;
  }

  const tabs = createChromeTabsAdapter();
  sharedDependencies = {
    workerVersion: chrome.runtime.getManifest().version,
    capabilities: FOUNDATION_CAPABILITIES,
    tabs,
    visibleCapture: new VisibleCaptureCoordinator({ tabs }),
    now: () => new Date(),
  };
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
    }
  } catch (error) {
    return createErrorResponseMessage({
      requestId: parsed.value.requestId,
      error: normalizeError(error, {
        stage: "capture",
        userMessageKey: "errors.captureFailed",
        retryable: true,
        fallbackAllowed: false,
      }),
      sentAt: dependencies.now().toISOString(),
    });
  }
}

export function registerMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!targetsBackground(message)) {
      return false;
    }

    void routeRuntimeMessage(message, defaultDependencies()).then((response) => {
      if (response !== undefined) {
        sendResponse(response);
      }
    });
    return true;
  });
}
