import type { CaptureJob } from "@shared/contracts/domain";

import type { PersistentJobCoordinatorPort } from "./job-coordinator";

export interface ModeCaptureCoordinatorPort {
  start(jobId: string): Promise<void>;
  cancel(
    jobId: string,
    reason?: string,
    disposition?: "discard" | "keep-partial",
  ): Promise<CaptureJob>;
  waitForIdle?(jobId: string): Promise<void>;
}

export interface ModeAwareCaptureCoordinatorOptions {
  jobs: Pick<PersistentJobCoordinatorPort, "get">;
  fullPage: ModeCaptureCoordinatorPort;
  targeted: ModeCaptureCoordinatorPort;
}

export class ModeAwareCaptureCoordinator implements ModeCaptureCoordinatorPort {
  constructor(private readonly options: ModeAwareCaptureCoordinatorOptions) {}

  async start(jobId: string): Promise<void> {
    const coordinator = await this.resolve(jobId);
    await coordinator.start(jobId);
  }

  async cancel(
    jobId: string,
    reason?: string,
    disposition: "discard" | "keep-partial" = "discard",
  ): Promise<CaptureJob> {
    const coordinator = await this.resolve(jobId);
    return coordinator.cancel(jobId, reason, disposition);
  }

  async waitForIdle(jobId: string): Promise<void> {
    const coordinator = await this.resolve(jobId);
    await coordinator.waitForIdle?.(jobId);
  }

  private async resolve(jobId: string): Promise<ModeCaptureCoordinatorPort> {
    const job = await this.options.jobs.get(jobId);
    return job?.mode === "full-page" ? this.options.fullPage : this.options.targeted;
  }
}
