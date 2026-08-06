import { createJobSummaryChangedEvent } from "@shared/contracts/job-events";
import type { JobSummary } from "@shared/contracts/job";

export interface JobSummaryEventPublisherPort {
  publish(summary: JobSummary): Promise<void>;
}

export interface RuntimeEventMessenger {
  sendMessage(message: unknown): Promise<unknown>;
}

const chromeRuntimeEventMessenger: RuntimeEventMessenger = {
  sendMessage: (message) => chrome.runtime.sendMessage(message),
};

export class ChromeJobSummaryEventPublisher implements JobSummaryEventPublisherPort {
  constructor(
    private readonly runtime: RuntimeEventMessenger = chromeRuntimeEventMessenger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publish(summary: JobSummary): Promise<void> {
    try {
      await this.runtime.sendMessage(
        createJobSummaryChangedEvent({
          summary,
          sentAt: this.now().toISOString(),
        }),
      );
    } catch {
      // The popup may be closed. Durable session state remains the source of truth.
    }
  }
}
