import { PAGE_PREPARATION_CONTENT_SCRIPT_FILE } from "@shared/contracts/page-preparation";

export interface PagePreparationBrowserAdapter {
  inject(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export function createChromePagePreparationAdapter(): PagePreparationBrowserAdapter {
  return {
    async inject(tabId) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        files: [PAGE_PREPARATION_CONTENT_SCRIPT_FILE],
      });
      if (results.length === 0) {
        throw new Error("Chrome did not report a content-script injection result.");
      }
    },
    sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  };
}
