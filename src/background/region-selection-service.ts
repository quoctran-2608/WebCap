import { PAGE_PREPARATION_CONTENT_SCRIPT_FILE } from "@shared/contracts/page-preparation";
import {
  createRegionSelectionCloseMessage,
  createRegionSelectionOpenMessage,
  parseRegionSelectionCloseResponse,
  parseRegionSelectionOpenResponse,
} from "@shared/contracts/region-selection";
import { createWebCapRuntimeError } from "@shared/errors/error";

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
  ) {}

  async start(tabId: number, jobId: string): Promise<void> {
    await this.browser.injectContentScript(tabId);
    const requestId = this.requestId();
    const response = await this.browser.sendMessage(
      tabId,
      createRegionSelectionOpenMessage({
        requestId,
        jobId,
        sentAt: this.now().toISOString(),
      }),
    );
    const parsed = parseRegionSelectionOpenResponse(response, requestId);
    if (!parsed.ok) {
      throw createWebCapRuntimeError(parsed.error);
    }
    if (parsed.value.payload.jobId !== jobId) {
      throw new Error("Region selection response did not match the capture job.");
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
