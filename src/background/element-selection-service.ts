import { PAGE_PREPARATION_CONTENT_SCRIPT_FILE } from "@shared/contracts/page-preparation";
import type { CaptureJob, Rect } from "@shared/contracts/domain";
import {
  createElementSelectionOpenMessage,
  createElementTargetRevalidateMessage,
  parseElementSelectionOpenResponse,
  parseElementTargetRevalidateResponse,
} from "@shared/contracts/element-selection";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

export interface ElementSelectionBrowserAdapter {
  injectContentScript(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export interface ElementSelectionPort {
  start(tabId: number, jobId: string): Promise<void>;
}

export interface ElementTargetValidationPort {
  revalidate(job: CaptureJob): Promise<Rect>;
}

export function createChromeElementSelectionBrowserAdapter(): ElementSelectionBrowserAdapter {
  return {
    async injectContentScript(tabId) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [PAGE_PREPARATION_CONTENT_SCRIPT_FILE],
      });
    },
    sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  };
}

export class ElementSelectionService
  implements ElementSelectionPort, ElementTargetValidationPort
{
  constructor(
    private readonly browser: ElementSelectionBrowserAdapter,
    private readonly now: () => Date = () => new Date(),
    private readonly requestId: () => string = () => crypto.randomUUID(),
  ) {}

  async start(tabId: number, jobId: string): Promise<void> {
    await this.browser.injectContentScript(tabId);
    const requestId = this.requestId();
    const response = await this.browser.sendMessage(
      tabId,
      createElementSelectionOpenMessage({
        requestId,
        jobId,
        sentAt: this.now().toISOString(),
      }),
    );
    const parsed = parseElementSelectionOpenResponse(response, requestId);
    if (!parsed.ok) {
      throw createWebCapRuntimeError(parsed.error);
    }
    if (parsed.value.payload.jobId !== jobId) {
      throw new Error("Element selection response did not match the capture job.");
    }
  }

  async revalidate(job: CaptureJob): Promise<Rect> {
    if (job.mode !== "element" || job.targetDescriptor === undefined) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_TARGET_STALE",
          stage: "capture",
          message: "The selected element target is unavailable.",
          userMessageKey: "errors.targetStale",
          retryable: true,
          fallbackAllowed: false,
          causeCode: "ElementTargetDescriptorMissing",
          safeContext: { jobId: job.id },
        }),
      );
    }

    await this.browser.injectContentScript(job.tabId);
    const requestId = this.requestId();
    const response = await this.browser.sendMessage(
      job.tabId,
      createElementTargetRevalidateMessage({
        requestId,
        jobId: job.id,
        descriptor: job.targetDescriptor,
        sentAt: this.now().toISOString(),
      }),
    );
    const parsed = parseElementTargetRevalidateResponse(response, requestId);
    if (!parsed.ok) {
      throw createWebCapRuntimeError(parsed.error);
    }
    if (
      parsed.value.payload.jobId !== job.id ||
      parsed.value.payload.descriptor.selectionId !== job.targetDescriptor.selectionId
    ) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_TARGET_STALE",
          stage: "capture",
          message: "The selected element identity changed before capture.",
          userMessageKey: "errors.targetStale",
          retryable: true,
          fallbackAllowed: false,
          causeCode: "ElementTargetIdentityMismatch",
          safeContext: { jobId: job.id },
        }),
      );
    }
    return parsed.value.payload.rect;
  }
}
