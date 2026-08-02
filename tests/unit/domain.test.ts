import { describe, expect, it } from "vitest";

import { CaptureJobSchema, CaptureSettingsSchema, RectSchema } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

describe("domain schemas", () => {
  it("accepts the default capture settings", () => {
    expect(CaptureSettingsSchema.parse(DEFAULT_CAPTURE_SETTINGS)).toEqual(DEFAULT_CAPTURE_SETTINGS);
  });

  it("rejects non-finite coordinates", () => {
    expect(RectSchema.safeParse({ x: Number.NaN, y: 0, width: 100, height: 100 }).success).toBe(
      false,
    );
  });

  it("rejects capture jobs with malformed settings", () => {
    const result = CaptureJobSchema.safeParse({
      schemaVersion: 1,
      id: "job-1",
      tabId: 1,
      windowId: 1,
      source: { createdAt: "2026-08-02T09:00:00.000Z" },
      mode: "visible",
      preferredEngine: "scroll",
      state: "created",
      stateRevision: 0,
      tilePlan: [],
      completedTiles: 0,
      totalTiles: 0,
      settings: { ...DEFAULT_CAPTURE_SETTINGS, imageQuality: 2 },
      cleanup: { attempted: false, completed: false },
      createdAt: "2026-08-02T09:00:00.000Z",
      updatedAt: "2026-08-02T09:00:00.000Z",
      expiresAt: "2026-08-02T09:30:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});
