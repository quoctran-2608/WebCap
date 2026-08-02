import { describe, expect, it } from "vitest";

import {
  JobSessionStateSchema,
  StoredDedupeRecordSchema,
  StoredTileRecordSchema,
  summarizeJob,
} from "@shared/contracts/job";
import type { CaptureJob } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const timestamp = "2026-08-02T16:00:00.000Z";

function job(): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { createdAt: timestamp },
    mode: "full-page",
    preferredEngine: "cdp",
    state: "created",
    stateRevision: 0,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: "2026-08-02T16:30:00.000Z",
  };
}

describe("persistent job record contracts", () => {
  it("summarizes jobs without settings, tile plans, or binary values", () => {
    const summary = summarizeJob(job());
    const serialized = JSON.stringify(summary);
    expect(summary).toMatchObject({ jobId: "job-1", state: "created", stateRevision: 0 });
    expect(serialized).not.toContain("settings");
    expect(serialized).not.toContain("tilePlan");
    expect(serialized).not.toContain("blob");
  });

  it("rejects tile records whose compound key disagrees with tile metadata", () => {
    const parsed = StoredTileRecordSchema.safeParse({
      schemaVersion: 1,
      jobId: "job-1",
      index: 1,
      tile: {
        id: "tile-0",
        jobId: "job-1",
        index: 0,
        row: 0,
        column: 0,
        sourceRectCss: { x: 0, y: 0, width: 100, height: 100 },
        expectedPixelWidth: 100,
        expectedPixelHeight: 100,
        overlapTopCss: 0,
        overlapLeftCss: 0,
        status: "planned",
        attempts: 0,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts Blob tile payloads only in IndexedDB records", () => {
    const parsed = StoredTileRecordSchema.parse({
      schemaVersion: 1,
      jobId: "job-1",
      index: 0,
      tile: {
        id: "tile-0",
        jobId: "job-1",
        index: 0,
        row: 0,
        column: 0,
        sourceRectCss: { x: 0, y: 0, width: 100, height: 100 },
        expectedPixelWidth: 100,
        expectedPixelHeight: 100,
        overlapTopCss: 0,
        overlapLeftCss: 0,
        status: "stored",
        attempts: 1,
      },
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(parsed.blob).toBeInstanceOf(Blob);
  });

  it("keeps session state metadata-only and versioned", () => {
    const state = JobSessionStateSchema.parse({
      schemaVersion: 1,
      summaries: [summarizeJob(job())],
      locks: [],
    });
    expect(JSON.stringify(state)).not.toContain("blob");
  });

  it("requires short-lived dedupe records to have an expiry", () => {
    expect(
      StoredDedupeRecordSchema.safeParse({
        schemaVersion: 1,
        requestId: "request-1",
        requestType: "JOB_GET",
        response: { ok: true },
        createdAt: timestamp,
      }).success,
    ).toBe(false);
  });
});
