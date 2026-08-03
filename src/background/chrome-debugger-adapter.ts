export interface DebuggerTarget {
  tabId: number;
}

export interface DebuggerDetachEvent {
  target: DebuggerTarget;
  reason: string;
}

export type DebuggerDetachListener = (event: DebuggerDetachEvent) => void;

export interface ChromeDebuggerAdapter {
  attach(target: DebuggerTarget, requiredVersion: string): Promise<void>;
  detach(target: DebuggerTarget): Promise<void>;
  sendCommand(
    target: DebuggerTarget,
    method: string,
    commandParams?: Record<string, unknown>,
  ): Promise<unknown>;
  addDetachListener(listener: DebuggerDetachListener): () => void;
}

export function createChromeDebuggerAdapter(): ChromeDebuggerAdapter {
  return {
    attach: (target, requiredVersion) => chrome.debugger.attach(target, requiredVersion),
    detach: (target) => chrome.debugger.detach(target),
    sendCommand: (target, method, commandParams) =>
      commandParams === undefined
        ? chrome.debugger.sendCommand(target, method)
        : chrome.debugger.sendCommand(target, method, commandParams),
    addDetachListener(listener) {
      const chromeListener = (source: chrome.debugger.Debuggee, reason: string) => {
        if (source.tabId !== undefined) {
          listener({ target: { tabId: source.tabId }, reason });
        }
      };

      chrome.debugger.onDetach.addListener(chromeListener);
      return () => chrome.debugger.onDetach.removeListener(chromeListener);
    },
  };
}
