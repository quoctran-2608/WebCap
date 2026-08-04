import { DEFAULT_REQUEST_TIMEOUT_MS } from "@shared/constants";
import {
  createPdfSourceDownloadMessage,
  createPdfSourceInspectMessage,
  isPdfSourceDownloadResponseMessage,
  isPdfSourceErrorMessage,
  isPdfSourceInspectResponseMessage,
  type PdfOriginalDownload,
  type PdfSourceCapability,
} from "@shared/contracts/pdf-source";

export interface PdfSourceRuntimeMessenger {
  sendMessage(message: unknown): Promise<unknown>;
}

export interface PdfSourceClientOptions {
  runtime?: PdfSourceRuntimeMessenger;
  now?: () => Date;
  requestId?: () => string;
  timeoutMs?: number;
}

const runtimeMessenger: PdfSourceRuntimeMessenger = {
  sendMessage: (message) => chrome.runtime.sendMessage(message),
};

function dependencies(options: PdfSourceClientOptions): {
  runtime: PdfSourceRuntimeMessenger;
  now: () => Date;
  createRequestId: () => string;
} {
  return {
    runtime: options.runtime ?? runtimeMessenger,
    now: options.now ?? (() => new Date()),
    createRequestId: options.requestId ?? (() => crypto.randomUUID()),
  };
}

function timeoutAfter(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => reject(new Error("PDF source request timed out.")), timeoutMs);
  });
}

async function send(
  runtime: PdfSourceRuntimeMessenger,
  message: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return Promise.race([runtime.sendMessage(message), timeoutAfter(timeoutMs)]);
}

function throwRemoteError(response: unknown): void {
  if (isPdfSourceErrorMessage(response)) {
    const error = new Error(response.payload.message);
    error.name = response.payload.code;
    throw error;
  }
}

export async function inspectPdfSource(
  options: PdfSourceClientOptions = {},
): Promise<PdfSourceCapability> {
  const { runtime, now, createRequestId } = dependencies(options);
  const request = createPdfSourceInspectMessage({
    requestId: createRequestId(),
    sentAt: now().toISOString(),
  });
  const response = await send(runtime, request, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  throwRemoteError(response);
  if (!isPdfSourceInspectResponseMessage(response) || response.requestId !== request.requestId) {
    throw new TypeError("Service worker returned an invalid PDF source inspection response.");
  }
  return response.payload;
}

export async function downloadOriginalPdf(
  expectedTabId: number,
  options: PdfSourceClientOptions = {},
): Promise<PdfOriginalDownload | PdfSourceCapability> {
  const { runtime, now, createRequestId } = dependencies(options);
  const request = createPdfSourceDownloadMessage({
    requestId: createRequestId(),
    expectedTabId,
    sentAt: now().toISOString(),
  });
  const response = await send(runtime, request, options.timeoutMs ?? 60_000);
  throwRemoteError(response);
  if (!isPdfSourceDownloadResponseMessage(response) || response.requestId !== request.requestId) {
    throw new TypeError("Service worker returned an invalid original PDF response.");
  }
  return response.payload.status === "downloaded"
    ? response.payload.result
    : response.payload.capability;
}
