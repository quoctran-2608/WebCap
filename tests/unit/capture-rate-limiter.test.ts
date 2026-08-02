import { describe, expect, it } from "vitest";

import { CaptureRateLimiter } from "@background/capture-rate-limiter";

describe("CaptureRateLimiter", () => {
  it("serializes calls and waits for the configured interval", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const limiter = new CaptureRateLimiter({
      minimumIntervalMs: 550,
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    });
    const starts: number[] = [];

    const first = limiter.run(async () => {
      starts.push(now);
      return "first";
    });
    const second = limiter.run(async () => {
      starts.push(now);
      return "second";
    });

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(starts).toEqual([1_000, 1_550]);
    expect(sleeps).toEqual([550]);
  });

  it("continues the queue after a failed task", async () => {
    const limiter = new CaptureRateLimiter({
      minimumIntervalMs: 0,
      now: () => 1,
      sleep: async () => undefined,
    });

    await expect(limiter.run(async () => Promise.reject(new Error("capture failed")))).rejects.toThrow(
      "capture failed",
    );
    await expect(limiter.run(async () => "recovered")).resolves.toBe("recovered");
  });
});
