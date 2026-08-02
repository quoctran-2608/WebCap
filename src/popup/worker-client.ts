import type { CaptureCapabilities } from "@shared/capabilities";
import {
  createCapabilitiesGetMessage,
  createPingMessage,
  isCapabilitiesResponseMessage,
  isErrorResponseMessage,
  isPongMessage,
  type PongMessage,
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

export async function pingWorker(options: WorkerRequestOptions = {}): Promise<PongMessage> {
  const runtime = options.runtime ?? chromeRuntimeMessenger;
  const now = options.now ?? (() => new Date());
  const createRequestId = options.requestId ?? (() => crypto.randomUUID());
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
  const runtime = options.runtime ?? chromeRuntimeMessenger;
  const now = options.now ?? (() => new Date());
  const createRequestId = options.requestId ?? (() => crypto.randomUUID());
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
