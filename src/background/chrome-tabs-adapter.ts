export interface ActiveTabSnapshot {
  id: number;
  windowId: number;
  active: boolean;
  url?: string;
  title?: string;
}

export interface TabsCaptureAdapter {
  queryActiveTab(): Promise<ActiveTabSnapshot | undefined>;
  captureVisibleTab(windowId: number): Promise<string>;
}

export function createChromeTabsAdapter(): TabsCaptureAdapter {
  return {
    async queryActiveTab() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab === undefined || tab.id === undefined) {
        return undefined;
      }

      return {
        id: tab.id,
        windowId: tab.windowId,
        active: tab.active,
        ...(tab.url === undefined ? {} : { url: tab.url }),
        ...(tab.title === undefined ? {} : { title: tab.title }),
      };
    },
    captureVisibleTab: (windowId) => chrome.tabs.captureVisibleTab(windowId, { format: "png" }),
  };
}
