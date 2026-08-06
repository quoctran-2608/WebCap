import { POPUP_PREFERENCES_STORAGE_KEY } from "@shared/constants";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import {
  DEFAULT_POPUP_PREFERENCES,
  StoredPopupPreferencesSchema,
  migratePopupPreferences,
  type ModeOutputPreferences,
  type StoredPopupPreferences,
} from "@shared/popup-preferences";
import { err, ok, type Result } from "@shared/result";
import {
  chromeLocalStorageAdapter,
  type StorageAreaAdapter,
} from "@storage/settings-repository";

export interface PopupPreferencesRepositoryPort {
  load(): Promise<Result<StoredPopupPreferences, WebCapErrorData>>;
  save(input: unknown): Promise<Result<StoredPopupPreferences, WebCapErrorData>>;
  reset(): Promise<Result<StoredPopupPreferences, WebCapErrorData>>;
  saveOutputByMode(
    outputByMode: ModeOutputPreferences,
  ): Promise<Result<StoredPopupPreferences, WebCapErrorData>>;
}

export class PopupPreferencesRepository implements PopupPreferencesRepositoryPort {
  constructor(private readonly storage: StorageAreaAdapter = chromeLocalStorageAdapter) {}

  async load(): Promise<Result<StoredPopupPreferences, WebCapErrorData>> {
    let stored: Record<string, unknown>;
    try {
      stored = await this.storage.get(POPUP_PREFERENCES_STORAGE_KEY);
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

    const migration = migratePopupPreferences(stored[POPUP_PREFERENCES_STORAGE_KEY]);
    if (!migration.ok) {
      return migration;
    }

    if (migration.value.migrated) {
      const persisted = await this.persist(migration.value.record);
      if (!persisted.ok) {
        return persisted;
      }
    }

    return ok(migration.value.record);
  }

  async save(input: unknown): Promise<Result<StoredPopupPreferences, WebCapErrorData>> {
    const parsed = StoredPopupPreferencesSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        createWebCapError({
          code: "E_SETTINGS_INVALID",
          stage: "storage",
          message: "Popup preference update failed runtime validation.",
          userMessageKey: "errors.settingsInvalid",
          retryable: false,
          fallbackAllowed: true,
        }),
      );
    }

    const persisted = await this.persist(parsed.data);
    return persisted.ok ? ok(parsed.data) : persisted;
  }

  saveOutputByMode(
    outputByMode: ModeOutputPreferences,
  ): Promise<Result<StoredPopupPreferences, WebCapErrorData>> {
    return this.save({
      schemaVersion: DEFAULT_POPUP_PREFERENCES.schemaVersion,
      outputByMode,
    });
  }

  reset(): Promise<Result<StoredPopupPreferences, WebCapErrorData>> {
    return this.save(DEFAULT_POPUP_PREFERENCES);
  }

  private async persist(
    record: StoredPopupPreferences,
  ): Promise<Result<void, WebCapErrorData>> {
    try {
      await this.storage.set({ [POPUP_PREFERENCES_STORAGE_KEY]: record });
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
