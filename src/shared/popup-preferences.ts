import { z } from "zod";

import { POPUP_PREFERENCES_SCHEMA_VERSION } from "@shared/constants";
import { ImageFormatSchema, type CaptureMode, type ImageFormat } from "@shared/contracts/domain";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

export const ModeOutputPreferencesSchema = z
  .object({
    visible: ImageFormatSchema,
    "full-page": z.literal("pdf"),
    region: ImageFormatSchema,
    element: ImageFormatSchema,
    "scroll-area": z.literal("pdf"),
  })
  .strict();

export const StoredPopupPreferencesSchema = z
  .object({
    schemaVersion: z.literal(POPUP_PREFERENCES_SCHEMA_VERSION),
    outputByMode: ModeOutputPreferencesSchema,
  })
  .strict();

export type ModeOutputPreferences = z.infer<typeof ModeOutputPreferencesSchema>;
export type StoredPopupPreferences = z.infer<typeof StoredPopupPreferencesSchema>;

export const DEFAULT_MODE_OUTPUT_PREFERENCES: ModeOutputPreferences = Object.freeze({
  visible: "png",
  "full-page": "pdf",
  region: "png",
  element: "png",
  "scroll-area": "pdf",
});

export const DEFAULT_POPUP_PREFERENCES: StoredPopupPreferences = Object.freeze({
  schemaVersion: POPUP_PREFERENCES_SCHEMA_VERSION,
  outputByMode: DEFAULT_MODE_OUTPUT_PREFERENCES,
});

export function migratePopupPreferences(
  input: unknown,
): Result<{ record: StoredPopupPreferences; migrated: boolean }, WebCapErrorData> {
  if (input === undefined) {
    return ok({ record: DEFAULT_POPUP_PREFERENCES, migrated: true });
  }

  const parsed = StoredPopupPreferencesSchema.safeParse(input);
  if (parsed.success) {
    return ok({ record: parsed.data, migrated: false });
  }

  return err(
    createWebCapError({
      code: "E_SETTINGS_INVALID",
      stage: "storage",
      message: "Stored popup preferences do not match a supported schema.",
      userMessageKey: "errors.settingsInvalid",
      retryable: false,
      fallbackAllowed: true,
    }),
  );
}

export function imageFormatForMode(
  preferences: ModeOutputPreferences,
  mode: CaptureMode,
): ImageFormat {
  const output = preferences[mode];
  return output === "pdf" ? "png" : output;
}
