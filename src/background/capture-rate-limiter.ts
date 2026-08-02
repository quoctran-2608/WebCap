export interface CaptureRateLimiterOptions {
  minimumIntervalMs: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });

export class CaptureRateLimiter {
  private readonly minimumIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private lastStartedAt: number | undefined;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: CaptureRateLimiterOptions) {
    this.minimumIntervalMs = options.minimumIntervalMs;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    const execution = this.tail.then(async () => {
      if (this.lastStartedAt !== undefined) {
        const remaining = this.minimumIntervalMs - (this.now() - this.lastStartedAt);
        if (remaining > 0) {
          await this.sleep(remaining);
        }
      }

      this.lastStartedAt = this.now();
      return task();
    });

    this.tail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }
}
