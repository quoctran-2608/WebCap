import { FOUNDATION_CAPABILITIES, type CaptureCapabilities } from "@shared/capabilities";
import {
  createCapabilitiesResponseMessage,
  createErrorResponseMessage,
  createPongMessage,
  parseBackgroundRequest,
  type BackgroundResponse,
} from "@shared/contracts/messages";

export interface MessageRouterDependencies {
  workerVersion: string;
  capabilities: CaptureCapabilities;
  now: () => Date;
}

const defaultDependencies = (): MessageRouterDependencies => ({
  workerVersion: chrome.runtime.getManifest().version,
  capabilities: FOUNDATION_CAPABILITIES,
  now: () => new Date(),
});

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

export function routeRuntimeMessage(
  message: unknown,
  dependencies: MessageRouterDependencies,
): BackgroundResponse | undefined {
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
  }
}

export function registerMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const response = routeRuntimeMessage(message, defaultDependencies());
    if (response === undefined) {
      return false;
    }

    sendResponse(response);
    return false;
  });
}
