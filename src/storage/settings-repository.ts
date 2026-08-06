import { SETTINGS_STORAGE_KEY } from "@shared/constants";
import { CaptureSettingsSchema, type CaptureSettings } from "@shared/contracts/domain";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import { err, ok, type Result } from "@shared/result";
import { DEFAULT_CAPTURE_SETTINGS, migrateSettings, type StoredSettings } from "@shared/settings";

export interface StorageAreaAdapter {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const chromeLocalStorageAdapter: StorageAreaAdapter = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
};

export class SettingsRepository {
  constructor(private readonly storage: StorageAreaAdapter = chromeLocalStorageAdapter) {}

  async load(): Promise<Result<CaptureSettings, WebCapErrorData>> {
    let stored: Record<string, unknown>;
    try {
      stored = await this.storage.get(SETTINGS_STORAGE_KEY);
    } catch (cause) {
      return err(
        normalizeError(cause, {
          code: "E_STORAGE_READ",
          stage: "storage",
          userMessageKey: "errors.settingsRead",
          retryable: true,
          fallbackAllowed: true,
        }),
      );
    }

    const migration = migrateSettings(stored[SETTINGS_STORAGE_KEY]);
    if (!migration.ok) {
      return migration;
    }

    if (migration.value.migrated) {
      const persisted = await this.persistRecord(migration.value.record);
      if (!persisted.ok) {
        return persisted;
      }
    }

    return ok(migration.value.record.settings);
  }

  async save(input: unknown): Promise<Result<CaptureSettings, WebCapErrorData>> {
    const parsed = CaptureSettingsSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        createWebCapError({
          code: "E_SETTINGS_INVALID",
          stage: "storage",
          message: "Settings update failed runtime validation.",
          userMessageKey: "errors.settingsInvalid",
          retryable: false,
          fallbackAllowed: true,
        }),
      );
    }

    const record: StoredSettings = { schemaVersion: 1, settings: parsed.data };
    const persisted = await this.persistRecord(record);
    return persisted.ok ? ok(parsed.data) : persisted;
  }

  reset(): Promise<Result<CaptureSettings, WebCapErrorData>> {
    return this.save(DEFAULT_CAPTURE_SETTINGS);
  }

  private async persistRecord(record: StoredSettings): Promise<Result<void, WebCapErrorData>> {
    try {
      await this.storage.set({ [SETTINGS_STORAGE_KEY]: record });
      return ok(undefined);
    } catch (cause) {
      return err(
        normalizeError(cause, {
          code: "E_STORAGE_WRITE",
          stage: "storage",
          userMessageKey: "errors.settingsWrite",
          retryable: true,
          fallbackAllowed: true,
        }),
      );
    }
  }
}
