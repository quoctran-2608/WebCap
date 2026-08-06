import { isJobSummaryChangedEvent } from "@shared/contracts/job-events";
import type { JobSummary } from "@shared/contracts/job";

export type RuntimeMessageListener = (message: unknown) => void;

export interface RuntimeMessageEventPort {
  addListener(listener: RuntimeMessageListener): void;
  removeListener(listener: RuntimeMessageListener): void;
}

export interface CurrentJobRevision {
  jobId: string;
  tabId: number;
  stateRevision: number;
}

const chromeRuntimeMessageEvents: RuntimeMessageEventPort = {
  addListener: (listener) => chrome.runtime.onMessage.addListener(listener),
  removeListener: (listener) => chrome.runtime.onMessage.removeListener(listener),
};

export function shouldRefreshJobFromSummary(
  summary: JobSummary,
  current: CurrentJobRevision,
): boolean {
  return (
    summary.tabId === current.tabId &&
    summary.jobId === current.jobId &&
    summary.stateRevision > current.stateRevision
  );
}

export function subscribeToJobSummaryChanges(
  callback: (summary: JobSummary) => void,
  events: RuntimeMessageEventPort = chromeRuntimeMessageEvents,
): () => void {
  const listener: RuntimeMessageListener = (message) => {
    if (isJobSummaryChangedEvent(message)) {
      callback(message.payload.summary);
    }
  };
  events.addListener(listener);
  return () => events.removeListener(listener);
}
