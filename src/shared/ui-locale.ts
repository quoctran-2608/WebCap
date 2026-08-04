import { DEFAULT_UI_LOCALE, normalizeUiLocale, type UiLocale } from "@shared/i18n";

export const UI_LOCALE_STORAGE_KEY = "webcap.ui-locale";

export interface StoredUiLocale {
  schemaVersion: 1;
  locale: UiLocale;
}

export interface UiLocaleStorageAdapter {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const chromeStorageAdapter: UiLocaleStorageAdapter = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
};

function isStoredUiLocale(value: unknown): value is StoredUiLocale {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion === 1 &&
    "locale" in value &&
    (value.locale === "vi" || value.locale === "en")
  );
}

export async function loadUiLocale(
  storage: UiLocaleStorageAdapter = chromeStorageAdapter,
): Promise<UiLocale> {
  try {
    const stored = await storage.get(UI_LOCALE_STORAGE_KEY);
    const record = stored[UI_LOCALE_STORAGE_KEY];
    return isStoredUiLocale(record) ? record.locale : DEFAULT_UI_LOCALE;
  } catch {
    return DEFAULT_UI_LOCALE;
  }
}

export async function saveUiLocale(
  locale: unknown,
  storage: UiLocaleStorageAdapter = chromeStorageAdapter,
): Promise<UiLocale> {
  const normalized = normalizeUiLocale(locale);
  await storage.set({
    [UI_LOCALE_STORAGE_KEY]: {
      schemaVersion: 1,
      locale: normalized,
    },
  });
  return normalized;
}
