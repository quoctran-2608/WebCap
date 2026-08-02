import { describe, expect, it } from "vitest";

import { CaptureRateLimiter } from "@background/capture-rate-limiter";

describe("CaptureRateLimiter", () => {
  it("serializes calls and waits for the configured interval", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const limiter = new CaptureRateLimiter({
      minimumIntervalMs: 550,
      now: () => now,
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    });
    const starts: number[] = [];

    const first = limiter.run(() => {
      starts.push(now);
      return Promise.resolve("first");
    });
    const second = limiter.run(() => {
      starts.push(now);
      return Promise.resolve("second");
    });

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(starts).toEqual([1_000, 1_550]);
    expect(sleeps).toEqual([550]);
  });

  it("continues the queue after a failed task", async () => {
    const limiter = new CaptureRateLimiter({
      minimumIntervalMs: 0,
      now: () => 1,
      sleep: () => Promise.resolve(),
    });

    await expect(limiter.run(() => Promise.reject(new Error("capture failed")))).rejects.toThrow(
      "capture failed",
    );
    await expect(limiter.run(() => Promise.resolve("recovered"))).resolves.toBe("recovered");
  });
});
