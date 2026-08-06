import { describe, expect, it } from "vitest";

import { SETTINGS_STORAGE_KEY } from "@shared/constants";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import { SettingsRepository, type StorageAreaAdapter } from "@storage/settings-repository";

class MemoryStorage implements StorageAreaAdapter {
  readonly data: Record<string, unknown> = {};
  writes = 0;

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve({ [key]: this.data[key] });
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
    this.writes += 1;
    return Promise.resolve();
  }
}

describe("SettingsRepository", () => {
  it("persists defaults the first time settings are loaded", async () => {
    const storage = new MemoryStorage();
    const repository = new SettingsRepository(storage);

    const result = await repository.load();

    expect(result).toEqual({ ok: true, value: DEFAULT_CAPTURE_SETTINGS });
    expect(storage.writes).toBe(1);
    expect(storage.data[SETTINGS_STORAGE_KEY]).toMatchObject({ schemaVersion: 1 });
  });

  it("validates before saving", async () => {
    const storage = new MemoryStorage();
    const repository = new SettingsRepository(storage);

    const result = await repository.save({
      ...DEFAULT_CAPTURE_SETTINGS,
      imageQuality: 5,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "E_SETTINGS_INVALID" },
    });
    expect(storage.writes).toBe(0);
  });

  it("resets capture options without removing unrelated local data", async () => {
    const storage = new MemoryStorage();
    storage.data.other = { preserved: true };
    const repository = new SettingsRepository(storage);
    await repository.save({
      ...DEFAULT_CAPTURE_SETTINGS,
      imageQuality: 0.64,
      fixedElementMode: "remove",
    });

    await expect(repository.reset()).resolves.toEqual({
      ok: true,
      value: DEFAULT_CAPTURE_SETTINGS,
    });
    expect(storage.data.other).toEqual({ preserved: true });
    expect(storage.data[SETTINGS_STORAGE_KEY]).toEqual({
      schemaVersion: 1,
      settings: DEFAULT_CAPTURE_SETTINGS,
    });
  });

  it("normalizes storage write failures", async () => {
    const storage: StorageAreaAdapter = {
      get: () => Promise.resolve({}),
      set: () => Promise.reject(new DOMException("quota", "QuotaExceededError")),
    };
    const repository = new SettingsRepository(storage);

    const result = await repository.save(DEFAULT_CAPTURE_SETTINGS);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "E_STORAGE_WRITE",
        causeCode: "QuotaExceededError",
        retryable: true,
      },
    });
  });
});
