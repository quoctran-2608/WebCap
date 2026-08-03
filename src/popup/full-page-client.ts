import { DEFAULT_REQUEST_TIMEOUT_MS } from "@shared/constants";
import type { CaptureJob, ImageFormat } from "@shared/contracts/domain";
import {
  createJobCancelMessage,
  createJobCreateMessage,
  createJobGetActiveMessage,
  createJobGetMessage,
  isJobActiveResponseMessage,
  isJobResponseMessage,
} from "@shared/contracts/job-messages";
import { isErrorResponseMessage } from "@shared/contracts/messages";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

function rejectAfter(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => reject(new Error("Capture job request timed out.")), timeoutMs);
  });
}

async function sendJobRequest(
  request: unknown,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<CaptureJob> {
  const response: unknown = await Promise.race([
    chrome.runtime.sendMessage(request),
    rejectAfter(timeoutMs),
  ]);
  if (isErrorResponseMessage(response)) {
    const error = new Error(response.payload.message);
    error.name = response.payload.code;
    throw error;
  }
  if (!isJobResponseMessage(response)) {
    throw new TypeError("Service worker returned an invalid capture job response.");
  }
  if (
    typeof request !== "object" ||
    request === null ||
    !("requestId" in request) ||
    response.requestId !== request.requestId
  ) {
    throw new Error("Service worker response did not match the capture job request.");
  }
  return response.payload.job;
}

function startTiledCapture(options: {
  tabId: number;
  windowId: number;
  outputFormat: ImageFormat;
  mode: "full-page" | "region";
}): Promise<CaptureJob> {
  return sendJobRequest(
    createJobCreateMessage({
      requestId: crypto.randomUUID(),
      sentAt: new Date().toISOString(),
      tabId: options.tabId,
      windowId: options.windowId,
      mode: options.mode,
      preferredEngine: "cdp",
      settings: {
        ...DEFAULT_CAPTURE_SETTINGS,
        outputFormat: options.outputFormat,
      },
    }),
  );
}

export function startFullPageCapture(options: {
  tabId: number;
  windowId: number;
  outputFormat: ImageFormat;
}): Promise<CaptureJob> {
  return startTiledCapture({ ...options, mode: "full-page" });
}

export function startRegionCapture(options: {
  tabId: number;
  windowId: number;
  outputFormat: ImageFormat;
}): Promise<CaptureJob> {
  return startTiledCapture({ ...options, mode: "region" });
}

export function getCaptureJob(jobId: string): Promise<CaptureJob> {
  return sendJobRequest(
    createJobGetMessage({
      requestId: crypto.randomUUID(),
      jobId,
      sentAt: new Date().toISOString(),
    }),
  );
}

export async function getActiveCaptureJob(tabId: number): Promise<CaptureJob | undefined> {
  const request = createJobGetActiveMessage({
    requestId: crypto.randomUUID(),
    tabId,
    sentAt: new Date().toISOString(),
  });
  const response: unknown = await Promise.race([
    chrome.runtime.sendMessage(request),
    rejectAfter(DEFAULT_REQUEST_TIMEOUT_MS),
  ]);
  if (isErrorResponseMessage(response)) {
    const error = new Error(response.payload.message);
    error.name = response.payload.code;
    throw error;
  }
  if (!isJobActiveResponseMessage(response) || response.requestId !== request.requestId) {
    throw new TypeError("Service worker returned an invalid active capture response.");
  }
  return response.payload.job ?? undefined;
}

export function cancelFullPageCapture(jobId: string): Promise<CaptureJob> {
  return sendJobRequest(
    createJobCancelMessage({
      requestId: crypto.randomUUID(),
      jobId,
      reason: "popup cancellation",
      sentAt: new Date().toISOString(),
    }),
  );
}
