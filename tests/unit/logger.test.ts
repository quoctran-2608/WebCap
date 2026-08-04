import { describe, expect, it } from "vitest";

import {
  createLogger,
  type LogSink,
  type SafeLogContext,
  type SafeLogRecord,
} from "@shared/logger";

describe("safe logger", () => {
  it("drops fields outside the diagnostic allowlist and sanitizes tokens", () => {
    const records: SafeLogRecord[] = [];
    const sink: LogSink = { write: (record) => records.push(record) };
    const logger = createLogger({
      minimumLevel: "debug",
      sink,
      now: () => new Date("2026-08-02T09:00:00.000Z"),
    });
    const unsafeContext = {
      jobId: "1234567890abcdefghijkl",
      stage: "protocol",
      durationBucket: "https://private.test/?token=secret",
      tileIndex: Number.NaN,
      token: "secret",
      url: "https://example.test/private",
    } as unknown as SafeLogContext;

    logger.error("protocol failure https://private.test", unsafeContext);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      timestamp: "2026-08-02T09:00:00.000Z",
      jobId: "1234567890ab",
      stage: "protocol",
      event: "redacted",
    });
    expect(records[0]).not.toHaveProperty("token");
    expect(records[0]).not.toHaveProperty("url");
    expect(records[0]).not.toHaveProperty("tileIndex");
    expect(JSON.stringify(records[0])).not.toContain("token=secret");
  });

  it("defaults production logging to warn and error", () => {
    const records: SafeLogRecord[] = [];
    const logger = createLogger({ sink: { write: (record) => records.push(record) } });

    logger.debug("ignored.debug");
    logger.info("ignored.info");
    logger.warn("kept.warn");
    logger.error("kept.error");

    expect(records.map((record) => record.event)).toEqual(["kept.warn", "kept.error"]);
  });
});
