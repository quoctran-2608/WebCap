import { describe, expect, it } from "vitest";

import {
  createLogger,
  type LogSink,
  type SafeLogContext,
  type SafeLogRecord,
} from "@shared/logger";

describe("safe logger", () => {
  it("drops fields outside the diagnostic allowlist", () => {
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
      token: "secret",
      url: "https://example.test/private",
    } as unknown as SafeLogContext;

    logger.error("protocol.failure", unsafeContext);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      timestamp: "2026-08-02T09:00:00.000Z",
      jobId: "1234567890ab",
      stage: "protocol",
    });
    expect(records[0]).not.toHaveProperty("token");
    expect(records[0]).not.toHaveProperty("url");
  });

  it("filters messages below the configured level", () => {
    const records: SafeLogRecord[] = [];
    const logger = createLogger({
      minimumLevel: "warn",
      sink: { write: (record) => records.push(record) },
    });

    logger.info("ignored");
    logger.warn("kept");

    expect(records.map((record) => record.event)).toEqual(["kept"]);
  });
});
