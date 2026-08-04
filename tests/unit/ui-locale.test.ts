import { describe, expect, it } from "vitest";

import {
  loadUiLocale,
  saveUiLocale,
  UI_LOCALE_STORAGE_KEY,
  type UiLocaleStorageAdapter,
} from "@shared/ui-locale";

function memoryStorage(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  const adapter: UiLocaleStorageAdapter = {
    get: (key) => Promise.resolve({ [key]: values[key] }),
    set: (items) => {
      Object.assign(values, items);
      return Promise.resolve();
    },
  };
  return { adapter, values };
}

describe("UI locale storage", () => {
  it("loads a valid persisted locale", async () => {
    const { adapter } = memoryStorage({
      [UI_LOCALE_STORAGE_KEY]: { schemaVersion: 1, locale: "en" },
    });
    await expect(loadUiLocale(adapter)).resolves.toBe("en");
  });

  it("falls back safely for malformed or unavailable storage", async () => {
    const malformed = memoryStorage({ [UI_LOCALE_STORAGE_KEY]: { locale: "fr" } });
    await expect(loadUiLocale(malformed.adapter)).resolves.toBe("vi");
    await expect(
      loadUiLocale({
        get: async () => Promise.reject(new Error("storage unavailable")),
        set: () => Promise.resolve(),
      }),
    ).resolves.toBe("vi");
  });

  it("normalizes and persists supported locale records", async () => {
    const { adapter, values } = memoryStorage();
    await expect(saveUiLocale("en", adapter)).resolves.toBe("en");
    expect(values[UI_LOCALE_STORAGE_KEY]).toEqual({ schemaVersion: 1, locale: "en" });
    await expect(saveUiLocale("unknown", adapter)).resolves.toBe("vi");
  });
});
