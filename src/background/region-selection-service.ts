import { PAGE_PREPARATION_CONTENT_SCRIPT_FILE } from "@shared/contracts/page-preparation";
import {
  createRegionSelectionCloseMessage,
  createRegionSelectionOpenMessage,
  parseRegionSelectionCloseResponse,
  parseRegionSelectionOpenResponse,
} from "@shared/contracts/region-selection";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

export const REGION_SELECTION_READY_TIMEOUT_MS = 2_000;

export interface RegionSelectionBrowserAdapter {
  injectContentScript(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export interface RegionSelectionPort {
  start(tabId: number, jobId: string): Promise<void>;
  cancel(tabId: number, jobId: string): Promise<boolean>;
}

export function createChromeRegionSelectionBrowserAdapter(): RegionSelectionBrowserAdapter {
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

export class RegionSelectionService implements RegionSelectionPort {
  constructor(
    private readonly browser: RegionSelectionBrowserAdapter,
    private readonly now: () => Date = () => new Date(),
    private readonly requestId: () => string = () => crypto.randomUUID(),
    private readonly readyTimeoutMs = REGION_SELECTION_READY_TIMEOUT_MS,
  ) {}

  async start(tabId: number, jobId: string): Promise<void> {
    await this.browser.injectContentScript(tabId);
    const requestId = this.requestId();
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        reject(
          createWebCapRuntimeError(
            createWebCapError({
              code: "E_PROTOCOL_MESSAGE",
              stage: "protocol",
              message: "The region selector did not become ready before the launch timeout.",
              userMessageKey: "errors.regionSelection",
              retryable: true,
              fallbackAllowed: false,
              causeCode: "RegionSelectionLaunchTimeout",
              safeContext: { jobId, tabId, timeoutMs: this.readyTimeoutMs },
            }),
          ),
        );
      }, this.readyTimeoutMs);
    });

    try {
      const response = await Promise.race([
        this.browser.sendMessage(
          tabId,
          createRegionSelectionOpenMessage({
            requestId,
            jobId,
            sentAt: this.now().toISOString(),
          }),
        ),
        timeout,
      ]);
      const parsed = parseRegionSelectionOpenResponse(response, requestId);
      if (!parsed.ok) {
        throw createWebCapRuntimeError(parsed.error);
      }
      if (parsed.value.payload.jobId !== jobId) {
        throw new Error("Region selection response did not match the capture job.");
      }
      if (
        parsed.value.payload.capabilities.resizeHandles !== 8 ||
        !parsed.value.payload.capabilities.pointerCreate ||
        !parsed.value.payload.capabilities.keyboardCreate ||
        !parsed.value.payload.capabilities.autoScroll
      ) {
        throw createWebCapRuntimeError(
          createWebCapError({
            code: "E_PROTOCOL_MESSAGE",
            stage: "protocol",
            message: "The region selector reported incomplete launch capabilities.",
            userMessageKey: "errors.regionSelection",
            retryable: true,
            fallbackAllowed: false,
            causeCode: "RegionSelectionCapabilitiesMissing",
            safeContext: { jobId, tabId },
          }),
        );
      }
    } finally {
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
    }
  }

  async cancel(tabId: number, jobId: string): Promise<boolean> {
    await this.browser.injectContentScript(tabId);
    const requestId = this.requestId();
    const response = await this.browser.sendMessage(
      tabId,
      createRegionSelectionCloseMessage({
        requestId,
        jobId,
        sentAt: this.now().toISOString(),
      }),
    );
    const parsed = parseRegionSelectionCloseResponse(response, requestId);
    if (!parsed.ok) {
      throw createWebCapRuntimeError(parsed.error);
    }
    return parsed.value.payload.closed;
  }
}
