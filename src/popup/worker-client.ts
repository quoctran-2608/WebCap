import type { CaptureCapabilities } from "@shared/capabilities";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "@shared/constants";
import {
  createCapabilitiesGetMessage,
  createPingMessage,
  createTabCapabilityGetMessage,
  createVisibleCaptureCancelMessage,
  createVisibleCaptureStartMessage,
  isCapabilitiesResponseMessage,
  isErrorResponseMessage,
  isPongMessage,
  isTabCapabilityResponseMessage,
  isVisibleCaptureCancelledMessage,
  isVisibleCaptureSuccessMessage,
  type PongMessage,
  type TabCapabilityPayload,
  type VisibleCaptureMetadata,
} from "@shared/contracts/messages";

const HANDSHAKE_TIMEOUT_MS = 3_000;

export interface RuntimeMessenger {
  getVersion(): string;
  sendMessage(message: unknown): Promise<unknown>;
}

export interface WorkerRequestOptions {
  runtime?: RuntimeMessenger;
  now?: () => Date;
  requestId?: () => string;
  timeoutMs?: number;
}

export interface VisibleCaptureRequestOptions extends WorkerRequestOptions {
  captureRequestId?: string;
}

const chromeRuntimeMessenger: RuntimeMessenger = {
  getVersion: () => chrome.runtime.getManifest().version,
  sendMessage: (message) => chrome.runtime.sendMessage(message),
};

function rejectAfter(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => {
      reject(new Error("Service worker request timed out."));
    }, timeoutMs);
  });
}

async function sendWithTimeout(
  runtime: RuntimeMessenger,
  request: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return Promise.race([runtime.sendMessage(request), rejectAfter(timeoutMs)]);
}

function throwRemoteError(response: unknown): void {
  if (isErrorResponseMessage(response)) {
    const error = new Error(response.payload.message);
    error.name = response.payload.code;
    throw error;
  }
}

function requestDependencies(options: WorkerRequestOptions): {
  runtime: RuntimeMessenger;
  now: () => Date;
  createRequestId: () => string;
} {
  return {
    runtime: options.runtime ?? chromeRuntimeMessenger,
    now: options.now ?? (() => new Date()),
    createRequestId: options.requestId ?? (() => crypto.randomUUID()),
  };
}

export async function pingWorker(options: WorkerRequestOptions = {}): Promise<PongMessage> {
  const { runtime, now, createRequestId } = requestDependencies(options);
  const request = createPingMessage({
    requestId: createRequestId(),
    clientVersion: runtime.getVersion(),
    sentAt: now().toISOString(),
  });
  const response = await sendWithTimeout(
    runtime,
    request,
    options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS,
  );

  throwRemoteError(response);
  if (!isPongMessage(response)) {
    throw new TypeError("Service worker returned an invalid handshake response.");
  }
  if (response.requestId !== request.requestId) {
    throw new Error("Service worker response did not match the request.");
  }

  return response;
}

export async function getCapabilities(
  options: WorkerRequestOptions = {},
): Promise<CaptureCapabilities> {
  const { runtime, now, createRequestId } = requestDependencies(options);
  const request = createCapabilitiesGetMessage({
    requestId: createRequestId(),
    sentAt: now().toISOString(),
  });
  const response = await sendWithTimeout(
    runtime,
    request,
    options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS,
  );

  throwRemoteError(response);
  if (!isCapabilitiesResponseMessage(response)) {
    throw new TypeError("Service worker returned invalid capabilities.");
  }
  if (response.requestId !== request.requestId) {
    throw new Error("Service worker response did not match the request.");
  }

  return response.payload;
}

export async function getTabCapability(
  options: WorkerRequestOptions = {},
): Promise<TabCapabilityPayload> {
  const { runtime, now, createRequestId } = requestDependencies(options);
  const request = createTabCapabilityGetMessage({
    requestId: createRequestId(),
    sentAt: now().toISOString(),
  });
  const response = await sendWithTimeout(
    runtime,
    request,
    options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS,
  );

  throwRemoteError(response);
  if (!isTabCapabilityResponseMessage(response)) {
    throw new TypeError("Service worker returned an invalid tab capability response.");
  }
  if (response.requestId !== request.requestId) {
    throw new Error("Service worker response did not match the request.");
  }

  return response.payload;
}

export async function startVisibleCapture(
  options: VisibleCaptureRequestOptions = {},
): Promise<VisibleCaptureMetadata> {
  const { runtime, now, createRequestId } = requestDependencies(options);
  const request = createVisibleCaptureStartMessage({
    requestId: options.captureRequestId ?? createRequestId(),
    sentAt: now().toISOString(),
  });
  const response = await sendWithTimeout(
    runtime,
    request,
    options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );

  throwRemoteError(response);
  if (!isVisibleCaptureSuccessMessage(response)) {
    throw new TypeError("Service worker returned an invalid visible capture response.");
  }
  if (response.requestId !== request.requestId) {
    throw new Error("Service worker response did not match the request.");
  }

  return response.payload;
}

export async function cancelVisibleCapture(
  captureRequestId: string,
  options: WorkerRequestOptions = {},
): Promise<boolean> {
  const { runtime, now, createRequestId } = requestDependencies(options);
  const request = createVisibleCaptureCancelMessage({
    requestId: createRequestId(),
    captureRequestId,
    sentAt: now().toISOString(),
  });
  const response = await sendWithTimeout(
    runtime,
    request,
    options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS,
  );

  throwRemoteError(response);
  if (!isVisibleCaptureCancelledMessage(response)) {
    throw new TypeError("Service worker returned an invalid cancellation response.");
  }
  if (response.requestId !== request.requestId) {
    throw new Error("Service worker response did not match the request.");
  }

  return response.payload.accepted;
}
