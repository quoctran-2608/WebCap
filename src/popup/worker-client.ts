import {
  createPingMessage,
  isPongMessage,
  type PongMessage,
} from "@shared/contracts/handshake";

const HANDSHAKE_TIMEOUT_MS = 3_000;

export interface RuntimeMessenger {
  getVersion(): string;
  sendMessage(message: unknown): Promise<unknown>;
}

export interface PingWorkerOptions {
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
      reject(new Error("Service worker handshake timed out."));
    }, timeoutMs);
  });
}

export async function pingWorker(options: PingWorkerOptions = {}): Promise<PongMessage> {
  const runtime = options.runtime ?? chromeRuntimeMessenger;
  const now = options.now ?? (() => new Date());
  const createRequestId = options.requestId ?? (() => crypto.randomUUID());
  const request = createPingMessage({
    requestId: createRequestId(),
    clientVersion: runtime.getVersion(),
    sentAt: now().toISOString(),
  });

  const response = await Promise.race([
    runtime.sendMessage(request),
    rejectAfter(options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS),
  ]);

  if (!isPongMessage(response)) {
    throw new TypeError("Service worker returned an invalid handshake response.");
  }

  if (response.requestId !== request.requestId) {
    throw new Error("Service worker response did not match the request.");
  }

  return response;
}
