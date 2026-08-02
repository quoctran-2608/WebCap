import { describe, expect, it } from "vitest";

import { migrateSettings, DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

describe("settings migration", () => {
  it("creates and marks defaults for empty storage", () => {
    const result = migrateSettings(undefined);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.migrated).toBe(true);
      expect(result.value.record.settings).toEqual(DEFAULT_CAPTURE_SETTINGS);
    }
  });

  it("preserves a valid version 1 record", () => {
    const record = { schemaVersion: 1, settings: DEFAULT_CAPTURE_SETTINGS } as const;
    const result = migrateSettings(record);

    expect(result).toEqual({ ok: true, value: { record, migrated: false } });
  });

  it("migrates legacy partial settings without losing nested defaults", () => {
    const result = migrateSettings({
      schemaVersion: 0,
      outputFormat: "jpeg",
      lazyLoad: { enabled: false },
      pdf: { marginMm: 12 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.record.settings.outputFormat).toBe("jpeg");
      expect(result.value.record.settings.lazyLoad.enabled).toBe(false);
      expect(result.value.record.settings.lazyLoad.settleMs).toBe(
        DEFAULT_CAPTURE_SETTINGS.lazyLoad.settleMs,
      );
      expect(result.value.record.settings.pdf.marginMm).toBe(12);
    }
  });

  it("returns a normalized error for unsupported data", () => {
    const result = migrateSettings("not-an-object");

    expect(result).toMatchObject({
      ok: false,
      error: { code: "E_SETTINGS_INVALID", stage: "storage" },
    });
  });
});
