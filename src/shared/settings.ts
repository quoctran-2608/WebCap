import { z } from "zod";

import {
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_LAZY_LOAD_MAX_DURATION_MS,
  DEFAULT_LAZY_LOAD_SETTLE_MS,
  DEFAULT_LAZY_LOAD_STEP_RATIO,
  DEFAULT_MAX_CSS_HEIGHT,
  DEFAULT_MAX_CSS_WIDTH,
  DEFAULT_MAX_ESTIMATED_BYTES,
  DEFAULT_MAX_TILES,
  DEFAULT_PDF_JPEG_QUALITY,
  DEFAULT_PDF_MARGIN_MM,
  SETTINGS_SCHEMA_VERSION,
} from "@shared/constants";
import { CaptureSettingsSchema, type CaptureSettings } from "@shared/contracts/domain";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = Object.freeze({
  outputFormat: "png",
  imageQuality: DEFAULT_IMAGE_QUALITY,
  fixedElementMode: "smart",
  lazyLoad: Object.freeze({
    enabled: true,
    stepRatio: DEFAULT_LAZY_LOAD_STEP_RATIO,
    settleMs: DEFAULT_LAZY_LOAD_SETTLE_MS,
    maxDurationMs: DEFAULT_LAZY_LOAD_MAX_DURATION_MS,
  }),
  limits: Object.freeze({
    maxCssHeight: DEFAULT_MAX_CSS_HEIGHT,
    maxCssWidth: DEFAULT_MAX_CSS_WIDTH,
    maxTiles: DEFAULT_MAX_TILES,
    maxEstimatedBytes: DEFAULT_MAX_ESTIMATED_BYTES,
  }),
  pdf: Object.freeze({
    pageSize: "a4",
    orientation: "portrait",
    marginMm: DEFAULT_PDF_MARGIN_MM,
    jpegQuality: DEFAULT_PDF_JPEG_QUALITY,
  }),
});

export const StoredSettingsSchema = z
  .object({
    schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
    settings: CaptureSettingsSchema,
  })
  .strict();

const LegacySettingsSchema = z
  .object({
    schemaVersion: z.literal(0).optional(),
    outputFormat: CaptureSettingsSchema.shape.outputFormat.optional(),
    imageQuality: CaptureSettingsSchema.shape.imageQuality.optional(),
    fixedElementMode: CaptureSettingsSchema.shape.fixedElementMode.optional(),
    lazyLoad: CaptureSettingsSchema.shape.lazyLoad.partial().optional(),
    limits: CaptureSettingsSchema.shape.limits.partial().optional(),
    pdf: CaptureSettingsSchema.shape.pdf.partial().optional(),
  })
  .passthrough();

export type StoredSettings = z.infer<typeof StoredSettingsSchema>;

export interface SettingsMigration {
  record: StoredSettings;
  migrated: boolean;
}

function buildStoredSettings(settings: CaptureSettings): StoredSettings {
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, settings };
}

export function migrateSettings(input: unknown): Result<SettingsMigration, WebCapErrorData> {
  if (input === undefined) {
    return ok({ record: buildStoredSettings(DEFAULT_CAPTURE_SETTINGS), migrated: true });
  }

  const current = StoredSettingsSchema.safeParse(input);
  if (current.success) {
    return ok({ record: current.data, migrated: false });
  }

  const legacy = LegacySettingsSchema.safeParse(input);
  if (!legacy.success) {
    return err(
      createWebCapError({
        code: "E_SETTINGS_INVALID",
        stage: "storage",
        message: "Stored settings do not match a supported schema.",
        userMessageKey: "errors.settingsInvalid",
        retryable: false,
        fallbackAllowed: true,
      }),
    );
  }

  const candidate = {
    outputFormat: legacy.data.outputFormat ?? DEFAULT_CAPTURE_SETTINGS.outputFormat,
    imageQuality: legacy.data.imageQuality ?? DEFAULT_CAPTURE_SETTINGS.imageQuality,
    fixedElementMode: legacy.data.fixedElementMode ?? DEFAULT_CAPTURE_SETTINGS.fixedElementMode,
    lazyLoad: {
      ...DEFAULT_CAPTURE_SETTINGS.lazyLoad,
      ...legacy.data.lazyLoad,
    },
    limits: {
      ...DEFAULT_CAPTURE_SETTINGS.limits,
      ...legacy.data.limits,
    },
    pdf: {
      ...DEFAULT_CAPTURE_SETTINGS.pdf,
      ...legacy.data.pdf,
    },
  };

  const parsed = CaptureSettingsSchema.safeParse(candidate);
  if (!parsed.success) {
    return err(
      createWebCapError({
        code: "E_SETTINGS_INVALID",
        stage: "storage",
        message: "Legacy settings could not be migrated safely.",
        userMessageKey: "errors.settingsInvalid",
        retryable: false,
        fallbackAllowed: true,
      }),
    );
  }

  return ok({ record: buildStoredSettings(parsed.data), migrated: true });
}
