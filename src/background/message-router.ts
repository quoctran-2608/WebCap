import {
  createPongMessage,
  isPingMessage,
  type PongMessage,
} from "@shared/contracts/handshake";

export interface MessageRouterDependencies {
  workerVersion: string;
  now: () => Date;
}

export function routeRuntimeMessage(
  message: unknown,
  dependencies: MessageRouterDependencies,
): PongMessage | undefined {
  if (!isPingMessage(message)) {
    return undefined;
  }

  return createPongMessage({
    requestId: message.requestId,
    workerVersion: dependencies.workerVersion,
    requestSentAt: message.sentAt,
    sentAt: dependencies.now().toISOString(),
  });
}

export function registerMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const response = routeRuntimeMessage(message, {
      workerVersion: chrome.runtime.getManifest().version,
      now: () => new Date(),
    });

    if (response === undefined) {
      return false;
    }

    sendResponse(response);
    return false;
  });
}
