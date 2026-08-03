import { DEFAULT_REQUEST_TIMEOUT_MS } from "@shared/constants";
import type { CaptureJob, ImageFormat } from "@shared/contracts/domain";
import {
  createJobCancelMessage,
  createJobCreateMessage,
  createJobGetMessage,
  isJobResponseMessage,
} from "@shared/contracts/job-messages";
import { isErrorResponseMessage } from "@shared/contracts/messages";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

function rejectAfter(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => reject(new Error("Full-page job request timed out.")), timeoutMs);
  });
}

async function sendJobRequest(request: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<CaptureJob> {
  const response = await Promise.race([chrome.runtime.sendMessage(request), rejectAfter(timeoutMs)]);
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

export function startFullPageCapture(options: {
  tabId: number;
  windowId: number;
  outputFormat: ImageFormat;
}): Promise<CaptureJob> {
  const sentAt = new Date().toISOString();
  return sendJobRequest(
    createJobCreateMessage({
      requestId: crypto.randomUUID(),
      sentAt,
      tabId: options.tabId,
      windowId: options.windowId,
      mode: "full-page",
      preferredEngine: "cdp",
      settings: {
        ...DEFAULT_CAPTURE_SETTINGS,
        outputFormat: options.outputFormat,
      },
    }),
  );
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
