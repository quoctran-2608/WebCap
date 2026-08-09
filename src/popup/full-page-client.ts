import { throwRemoteWebCapError } from "@shared/errors/remote-error";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "@shared/constants";
import {
  createCaptureResetRequest,
  isCaptureResetResponse,
  type CaptureResetReport,
} from "@shared/contracts/capture-reset";
import type { CaptureJob, CaptureSettings } from "@shared/contracts/domain";
import type { PdfDocumentManifest } from "@shared/contracts/pdf-capture";
import {
  createJobCancelMessage,
  createJobCreateMessage,
  createJobGetActiveMessage,
  createJobGetMessage,
  createJobResumeMessage,
  createPdfExportStartMessage,
  createPdfManifestGetMessage,
  isJobActiveResponseMessage,
  isJobResponseMessage,
  isPdfManifestResponseMessage,
} from "@shared/contracts/job-messages";
import { isErrorResponseMessage } from "@shared/contracts/messages";

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
    throwRemoteWebCapError(response.payload);
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
  settings: CaptureSettings;
  mode: "full-page" | "region" | "element" | "scroll-area";
}): Promise<CaptureJob> {
  return sendJobRequest(
    createJobCreateMessage({
      requestId: crypto.randomUUID(),
      sentAt: new Date().toISOString(),
      tabId: options.tabId,
      windowId: options.windowId,
      mode: options.mode,
      preferredEngine:
        options.mode === "full-page" || options.mode === "scroll-area" ? "scroll" : "cdp",
      settings: options.settings,
    }),
  );
}

export function startFullPageCapture(options: {
  tabId: number;
  windowId: number;
  settings: CaptureSettings;
}): Promise<CaptureJob> {
  return startTiledCapture({ ...options, mode: "full-page" });
}

export function startRegionCapture(options: {
  tabId: number;
  windowId: number;
  settings: CaptureSettings;
}): Promise<CaptureJob> {
  return startTiledCapture({ ...options, mode: "region" });
}

export function startElementCapture(options: {
  tabId: number;
  windowId: number;
  settings: CaptureSettings;
}): Promise<CaptureJob> {
  return startTiledCapture({ ...options, mode: "element" });
}

export function startScrollAreaCapture(options: {
  tabId: number;
  windowId: number;
  settings: CaptureSettings;
}): Promise<CaptureJob> {
  return startTiledCapture({ ...options, mode: "scroll-area" });
}

/**
 * Starts a fail-closed, source-page-aware PDF viewer capture. The explicit PDF
 * output format is the persisted intent signal used by the scroll capture
 * stack; ordinary scroll-area capture keeps its existing behavior.
 */
export function startPdfViewerCapture(options: {
  tabId: number;
  windowId: number;
  settings: CaptureSettings;
}): Promise<CaptureJob> {
  return startTiledCapture({
    ...options,
    mode: "scroll-area",
    settings: { ...options.settings, outputFormat: "pdf" },
  });
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

export function resumeCaptureJob(jobId: string): Promise<CaptureJob> {
  return sendJobRequest(
    createJobResumeMessage({
      requestId: crypto.randomUUID(),
      jobId,
      sentAt: new Date().toISOString(),
    }),
  );
}

export async function getPdfDocumentManifest(
  jobId: string,
): Promise<PdfDocumentManifest | undefined> {
  const request = createPdfManifestGetMessage({
    requestId: crypto.randomUUID(),
    jobId,
    sentAt: new Date().toISOString(),
  });
  const response: unknown = await Promise.race([
    chrome.runtime.sendMessage(request),
    rejectAfter(DEFAULT_REQUEST_TIMEOUT_MS),
  ]);
  if (isErrorResponseMessage(response)) {
    throwRemoteWebCapError(response.payload);
  }
  if (!isPdfManifestResponseMessage(response) || response.requestId !== request.requestId) {
    throw new TypeError("Service worker returned an invalid PDF manifest response.");
  }
  return response.payload.manifest ?? undefined;
}

export function startPdfExport(
  jobId: string,
  settings?: CaptureSettings["pdf"],
): Promise<CaptureJob> {
  return sendJobRequest(
    createPdfExportStartMessage({
      requestId: crypto.randomUUID(),
      jobId,
      ...(settings === undefined ? {} : { settings }),
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
    throwRemoteWebCapError(response.payload);
  }
  if (!isJobActiveResponseMessage(response) || response.requestId !== request.requestId) {
    throw new TypeError("Service worker returned an invalid active capture response.");
  }
  return response.payload.job ?? undefined;
}

function requestFullPageCancellation(
  jobId: string,
  disposition: "discard" | "keep-partial",
): Promise<CaptureJob> {
  return sendJobRequest(
    createJobCancelMessage({
      requestId: crypto.randomUUID(),
      jobId,
      reason: disposition === "keep-partial" ? "popup partial stop" : "popup cancellation",
      disposition,
      sentAt: new Date().toISOString(),
    }),
  );
}

export function cancelFullPageCapture(jobId: string): Promise<CaptureJob> {
  return requestFullPageCancellation(jobId, "discard");
}

export function stopFullPageCapture(jobId: string): Promise<CaptureJob> {
  return requestFullPageCancellation(jobId, "keep-partial");
}

export async function resetCapture(
  options:
    | {
        scope: "visible-session";
      }
    | {
        scope: "job";
        jobId: string;
      }
    | {
        scope: "tab";
        tabId: number;
      },
): Promise<CaptureResetReport> {
  const request =
    options.scope === "job"
      ? createCaptureResetRequest({
          requestId: crypto.randomUUID(),
          sentAt: new Date().toISOString(),
          scope: "job",
          jobId: options.jobId,
        })
      : options.scope === "tab"
        ? createCaptureResetRequest({
            requestId: crypto.randomUUID(),
            sentAt: new Date().toISOString(),
            scope: "tab",
            tabId: options.tabId,
          })
        : createCaptureResetRequest({
            requestId: crypto.randomUUID(),
            sentAt: new Date().toISOString(),
            scope: "visible-session",
          });
  const response: unknown = await Promise.race([
    chrome.runtime.sendMessage(request),
    rejectAfter(DEFAULT_REQUEST_TIMEOUT_MS),
  ]);
  if (isErrorResponseMessage(response)) {
    throwRemoteWebCapError(response.payload);
  }
  if (!isCaptureResetResponse(response) || response.requestId !== request.requestId) {
    throw new TypeError("Service worker returned an invalid capture reset response.");
  }
  return response.payload;
}
