import { describe, expect, it } from "vitest";

import { POPUP_PREFERENCES_STORAGE_KEY } from "@shared/constants";
import { DEFAULT_POPUP_PREFERENCES } from "@shared/popup-preferences";
import { PopupPreferencesRepository } from "@storage/popup-preferences-repository";
import type { StorageAreaAdapter } from "@storage/settings-repository";

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

describe("PopupPreferencesRepository", () => {
  it("persists default mode outputs on first load", async () => {
    const storage = new MemoryStorage();
    const repository = new PopupPreferencesRepository(storage);

    await expect(repository.load()).resolves.toEqual({
      ok: true,
      value: DEFAULT_POPUP_PREFERENCES,
    });
    expect(storage.writes).toBe(1);
    expect(storage.data[POPUP_PREFERENCES_STORAGE_KEY]).toEqual(DEFAULT_POPUP_PREFERENCES);
  });

  it("persists image output independently for each supported image mode", async () => {
    const storage = new MemoryStorage();
    const repository = new PopupPreferencesRepository(storage);
    const outputByMode = {
      ...DEFAULT_POPUP_PREFERENCES.outputByMode,
      visible: "jpeg" as const,
      region: "webp" as const,
    };

    const result = await repository.saveOutputByMode(outputByMode);

    expect(result).toMatchObject({ ok: true, value: { outputByMode } });
    expect(storage.data[POPUP_PREFERENCES_STORAGE_KEY]).toMatchObject({ outputByMode });
  });

  it("resets outputs without touching capture data keys", async () => {
    const storage = new MemoryStorage();
    storage.data.other = { preserved: true };
    const repository = new PopupPreferencesRepository(storage);

    await repository.saveOutputByMode({
      ...DEFAULT_POPUP_PREFERENCES.outputByMode,
      element: "jpeg",
    });
    await expect(repository.reset()).resolves.toEqual({
      ok: true,
      value: DEFAULT_POPUP_PREFERENCES,
    });
    expect(storage.data.other).toEqual({ preserved: true });
  });
});
