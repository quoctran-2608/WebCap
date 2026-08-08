import {
  JobResumeMessageSchema,
  PdfManifestGetMessageSchema,
  createJobResponseMessage,
  createPdfManifestResponseMessage,
  type JobResponseMessage,
  type PdfManifestResponseMessage,
} from "@shared/contracts/job-messages";
import { createErrorResponseMessage, type ErrorResponseMessage } from "@shared/contracts/messages";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";

import { getPdfCaptureOrchestrator } from "./pdf-capture-runtime";
import { getPersistentJobRouterDependencies } from "./persistent-job-router";

export type PdfUxRouterResponse =
  JobResponseMessage | PdfManifestResponseMessage | ErrorResponseMessage;

function isPdfUxMessage(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === "PDF_MANIFEST_GET" || type === "JOB_RESUME";
}

function requestIdFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("requestId" in value)) return undefined;
  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}

function jobNotFound(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The requested capture job does not exist.",
      userMessageKey: "errors.jobNotFound",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "JobNotFound",
      safeContext: { jobId: jobId.slice(0, 24) },
    }),
  );
}

function resumeUnavailable(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The paused PDF job cannot be resumed by the available coordinator.",
      userMessageKey: "errors.jobCommand",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "PdfResumeCoordinatorUnavailable",
      safeContext: { jobId: jobId.slice(0, 24) },
    }),
  );
}

export async function routePdfUxMessage(
  message: unknown,
): Promise<PdfUxRouterResponse | undefined> {
  if (!isPdfUxMessage(message)) return undefined;
  const requestId = requestIdFrom(message);
  if (requestId === undefined) return undefined;
  const now = () => new Date().toISOString();

  const manifestRequest = PdfManifestGetMessageSchema.safeParse(message);
  if (manifestRequest.success) {
    try {
      const manifest =
        (await getPdfCaptureOrchestrator()?.getManifest(manifestRequest.data.payload.jobId)) ??
        null;
      return createPdfManifestResponseMessage({
        requestId,
        manifest,
        sentAt: now(),
      });
    } catch (error) {
      return createErrorResponseMessage({
        requestId,
        error: normalizeError(error, {
          stage: "storage",
          userMessageKey: "errors.storageRead",
          retryable: true,
          fallbackAllowed: false,
        }),
        sentAt: now(),
      });
    }
  }

  const resumeRequest = JobResumeMessageSchema.safeParse(message);
  if (!resumeRequest.success) {
    return createErrorResponseMessage({
      requestId,
      error: createWebCapError({
        code: "E_PROTOCOL_MESSAGE",
        stage: "protocol",
        message: "PDF UX request does not match a supported schema.",
        userMessageKey: "errors.protocolMessage",
        retryable: false,
        fallbackAllowed: false,
      }),
      sentAt: now(),
    });
  }

  try {
    const dependencies = getPersistentJobRouterDependencies();
    const current = await dependencies.jobs.get(resumeRequest.data.payload.jobId);
    if (current === undefined) throw jobNotFound(resumeRequest.data.payload.jobId);
    if (current.state !== "paused") {
      return createJobResponseMessage({ requestId, job: current, sentAt: now() });
    }

    if (current.activeOutputFormat === "pdf" && dependencies.pdfExports !== undefined) {
      const resumed = await dependencies.pdfExports.start(current.id, current.settings.pdf);
      return createJobResponseMessage({ requestId, job: resumed, sentAt: now() });
    }

    if (current.mode === "scroll-area" && dependencies.scrollAreaCaptures !== undefined) {
      void dependencies.scrollAreaCaptures
        .start(current.id)
        .then(() => dependencies.completion?.startAuto(current.id))
        .catch(() => undefined);
      const refreshed = (await dependencies.jobs.get(current.id)) ?? current;
      return createJobResponseMessage({ requestId, job: refreshed, sentAt: now() });
    }

    throw resumeUnavailable(current.id);
  } catch (error) {
    return createErrorResponseMessage({
      requestId,
      error: normalizeError(error, {
        stage: "capture",
        userMessageKey: "errors.jobCommand",
        retryable: true,
        fallbackAllowed: false,
      }),
      sentAt: now(),
    });
  }
}

export function registerPdfUxRouter(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isPdfUxMessage(message)) return false;
    void routePdfUxMessage(message).then((response) => {
      if (response !== undefined) sendResponse(response);
    });
    return true;
  });
}
