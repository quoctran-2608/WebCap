import { throwRemoteWebCapError } from "@shared/errors/remote-error";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "@shared/constants";
import {
  createPdfEditorGetMessage,
  createPdfEditorThumbnailGetMessage,
  createPdfEditorUpdateMessage,
  createPdfExportCancelMessage,
  isPdfEditorErrorMessage,
  isPdfEditorResponseMessage,
  isPdfEditorThumbnailResponseMessage,
  type PdfEditorSnapshot,
  type PdfEditorUpdateAction,
} from "@shared/contracts/pdf-editor";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import { createPdfEditorExportStartMessage } from "@shared/contracts/pdf-editor-export";

function rejectAfter(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => reject(new Error("PDF editor request timed out.")), timeoutMs);
  });
}

async function sendEditorRequest(request: unknown): Promise<PdfEditorSnapshot> {
  const response: unknown = await Promise.race([
    chrome.runtime.sendMessage(request),
    rejectAfter(DEFAULT_REQUEST_TIMEOUT_MS),
  ]);
  if (isPdfEditorErrorMessage(response)) {
    throwRemoteWebCapError(response.payload);
  }
  if (!isPdfEditorResponseMessage(response)) {
    throw new TypeError("Service worker returned an invalid PDF editor response.");
  }
  if (
    typeof request !== "object" ||
    request === null ||
    !("requestId" in request) ||
    response.requestId !== request.requestId
  ) {
    throw new Error("PDF editor response did not match the request.");
  }
  return response.payload;
}

export function getPdfEditorSnapshot(jobId: string): Promise<PdfEditorSnapshot> {
  return sendEditorRequest(
    createPdfEditorGetMessage({
      requestId: crypto.randomUUID(),
      jobId,
      sentAt: new Date().toISOString(),
    }),
  );
}

export async function getPdfEditorThumbnail(
  jobId: string,
  manifestRevision: number,
  pageId: string,
): Promise<ArtifactMetadata> {
  const request = createPdfEditorThumbnailGetMessage({
    requestId: crypto.randomUUID(),
    jobId,
    manifestRevision,
    pageId,
    sentAt: new Date().toISOString(),
  });
  const response: unknown = await Promise.race([
    chrome.runtime.sendMessage(request),
    rejectAfter(DEFAULT_REQUEST_TIMEOUT_MS),
  ]);
  if (isPdfEditorErrorMessage(response)) {
    throwRemoteWebCapError(response.payload);
  }
  if (!isPdfEditorThumbnailResponseMessage(response) || response.requestId !== request.requestId) {
    throw new TypeError("Service worker returned an invalid PDF thumbnail response.");
  }
  return response.payload;
}

export function updatePdfEditor(
  jobId: string,
  expectedRevision: number,
  action: PdfEditorUpdateAction,
): Promise<PdfEditorSnapshot> {
  return sendEditorRequest(
    createPdfEditorUpdateMessage({
      requestId: crypto.randomUUID(),
      jobId,
      expectedRevision,
      action,
      sentAt: new Date().toISOString(),
    }),
  );
}

export function startPdfEditorExport(jobId: string): Promise<PdfEditorSnapshot> {
  return sendEditorRequest(
    createPdfEditorExportStartMessage({
      requestId: crypto.randomUUID(),
      jobId,
      sentAt: new Date().toISOString(),
    }),
  );
}

export function cancelPdfEditorExport(jobId: string): Promise<PdfEditorSnapshot> {
  return sendEditorRequest(
    createPdfExportCancelMessage({
      requestId: crypto.randomUUID(),
      jobId,
      sentAt: new Date().toISOString(),
    }),
  );
}
