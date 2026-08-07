import { PROTOCOL_VERSION } from "@shared/constants";
import type { ElementTargetDescriptor } from "@shared/contracts/domain";
import type { PdfViewerDiscoveryRequestMessage } from "@shared/contracts/pdf-viewer-discovery";

import { isScrollableElement } from "./element-selector";
import { discoverPdfViewerSnapshot } from "./pdf-viewer-discovery";

const ELEMENT_SELECTION_GLOBAL_KEY = "__webcapElementSelectionV1__" as const;
const PDF_DISCOVERY_GLOBAL_KEY = "__webcapPdfViewerDiscoveryV1__" as const;

interface StoredElementTarget {
  jobId: string;
  element: Element;
  descriptor: ElementTargetDescriptor;
}

interface ElementSelectionRuntimeState {
  version: 1;
  targets: Map<string, StoredElementTarget>;
}

interface PdfDiscoveryRuntimeState {
  version: 1;
  listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void;
  pageHideListener: () => void;
}

interface RuntimeCarrier {
  __webcapElementSelectionV1__?: ElementSelectionRuntimeState;
  __webcapPdfViewerDiscoveryV1__?: PdfDiscoveryRuntimeState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPdfViewerDiscoveryRequest(value: unknown): value is PdfViewerDiscoveryRequestMessage {
  if (
    !isRecord(value) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.source !== "background" ||
    value.target !== "content" ||
    value.type !== "PDF_VIEWER_DISCOVERY" ||
    typeof value.requestId !== "string" ||
    typeof value.sentAt !== "string" ||
    !isRecord(value.payload) ||
    typeof value.payload.jobId !== "string" ||
    !isRecord(value.payload.descriptor) ||
    typeof value.payload.descriptor.selectionId !== "string" ||
    value.payload.descriptor.captureKind !== "full-scroll-content" ||
    !Number.isInteger(value.payload.settleMs) ||
    typeof value.payload.settleMs !== "number" ||
    value.payload.settleMs < 0
  ) {
    return false;
  }
  return true;
}

function responseEnvelope(
  request: PdfViewerDiscoveryRequestMessage,
  type: "PDF_VIEWER_DISCOVERED" | "PDF_VIEWER_DISCOVERY_ERROR",
  payload: unknown,
): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: request.requestId,
    source: "content",
    target: "background",
    type,
    payload,
    sentAt: new Date().toISOString(),
  };
}

function discoveryError(
  request: PdfViewerDiscoveryRequestMessage,
  options: { code: "E_TARGET_STALE" | "E_LAYOUT_UNSTABLE"; message: string; causeCode: string },
): Record<string, unknown> {
  return responseEnvelope(request, "PDF_VIEWER_DISCOVERY_ERROR", {
    code: options.code,
    stage: "capture",
    message: options.message,
    userMessageKey:
      options.code === "E_TARGET_STALE" ? "errors.targetStale" : "errors.scrollAreaCapture",
    retryable: true,
    fallbackAllowed: false,
    causeCode: options.causeCode,
    safeContext: { jobId: request.payload.jobId },
  });
}

export function installPdfViewerDiscoveryRuntime(): { installed: boolean; reused: boolean } {
  const carrier = globalThis as typeof globalThis & RuntimeCarrier;
  const existing = carrier[PDF_DISCOVERY_GLOBAL_KEY];
  if (existing?.version === PROTOCOL_VERSION) return { installed: true, reused: true };

  const state: PdfDiscoveryRuntimeState = {
    version: PROTOCOL_VERSION,
    listener: () => false,
    pageHideListener: () => undefined,
  };

  state.listener = (message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !isPdfViewerDiscoveryRequest(message)) return false;
    const elementRuntime = carrier[ELEMENT_SELECTION_GLOBAL_KEY];
    const stored = elementRuntime?.targets.get(message.payload.descriptor.selectionId);
    if (
      stored === undefined ||
      stored.jobId !== message.payload.jobId ||
      stored.descriptor.selectionId !== message.payload.descriptor.selectionId ||
      stored.descriptor.captureKind !== "full-scroll-content" ||
      !(stored.element instanceof HTMLElement) ||
      !stored.element.isConnected ||
      !isScrollableElement(stored.element)
    ) {
      sendResponse(
        discoveryError(message, {
          code: "E_TARGET_STALE",
          message: "The selected PDF viewer is no longer available for discovery.",
          causeCode: "PdfViewerDiscoveryTargetUnavailable",
        }),
      );
      return false;
    }

    void discoverPdfViewerSnapshot(stored.element, message.payload.settleMs)
      .then((snapshot) =>
        sendResponse(
          responseEnvelope(message, "PDF_VIEWER_DISCOVERED", {
            jobId: stored.jobId,
            descriptor: stored.descriptor,
            snapshot,
          }),
        ),
      )
      .catch((error: unknown) =>
        sendResponse(
          discoveryError(message, {
            code: "E_LAYOUT_UNSTABLE",
            message: error instanceof Error ? error.message : "PDF viewer discovery failed.",
            causeCode: error instanceof Error ? error.name : "PdfViewerDiscoveryFailure",
          }),
        ),
      );
    return true;
  };

  state.pageHideListener = () => {
    chrome.runtime.onMessage.removeListener(state.listener);
    if (carrier[PDF_DISCOVERY_GLOBAL_KEY] === state) delete carrier[PDF_DISCOVERY_GLOBAL_KEY];
  };
  chrome.runtime.onMessage.addListener(state.listener);
  window.addEventListener("pagehide", state.pageHideListener, { once: true });
  carrier[PDF_DISCOVERY_GLOBAL_KEY] = state;
  return { installed: true, reused: false };
}
