import type { CaptureSettings, CaptureMode, ImageFormat } from "@shared/contracts/domain";
import { createWebCapRuntimeError, type WebCapErrorData } from "@shared/errors/error";
import {
  DEFAULT_MODE_OUTPUT_PREFERENCES,
  imageFormatForMode,
  type ModeOutputPreferences,
} from "@shared/popup-preferences";
import type { Result } from "@shared/result";
import { PopupPreferencesRepository } from "@storage/popup-preferences-repository";
import { SettingsRepository } from "@storage/settings-repository";

export interface CaptureSettingsRepositoryPort {
  load(): Promise<Result<CaptureSettings, WebCapErrorData>>;
  save(input: unknown): Promise<Result<CaptureSettings, WebCapErrorData>>;
  reset(): Promise<Result<CaptureSettings, WebCapErrorData>>;
}

export interface ModeOutputRepositoryPort {
  load(): Promise<Result<{ outputByMode: ModeOutputPreferences }, WebCapErrorData>>;
  saveOutputByMode(
    outputByMode: ModeOutputPreferences,
  ): Promise<Result<{ outputByMode: ModeOutputPreferences }, WebCapErrorData>>;
  reset(): Promise<Result<{ outputByMode: ModeOutputPreferences }, WebCapErrorData>>;
}

export interface PopupSettingsSnapshot {
  capture: CaptureSettings;
  outputByMode: ModeOutputPreferences;
}

export class PopupSettingsClient {
  constructor(
    private readonly capture: CaptureSettingsRepositoryPort = new SettingsRepository(),
    private readonly outputs: ModeOutputRepositoryPort = new PopupPreferencesRepository(),
  ) {}

  async load(): Promise<PopupSettingsSnapshot> {
    const [capture, outputs] = await Promise.all([this.capture.load(), this.outputs.load()]);
    if (!capture.ok) {
      throw createWebCapRuntimeError(capture.error);
    }
    if (!outputs.ok) {
      throw createWebCapRuntimeError(outputs.error);
    }
    return { capture: capture.value, outputByMode: outputs.value.outputByMode };
  }

  async saveCapture(settings: CaptureSettings): Promise<CaptureSettings> {
    const saved = await this.capture.save(settings);
    if (!saved.ok) {
      throw createWebCapRuntimeError(saved.error);
    }
    return saved.value;
  }

  async saveModeOutput(
    current: ModeOutputPreferences,
    mode: CaptureMode,
    format: ImageFormat,
  ): Promise<ModeOutputPreferences> {
    if (mode === "full-page" || mode === "scroll-area") {
      return current;
    }
    const outputByMode = { ...current, [mode]: format };
    const saved = await this.outputs.saveOutputByMode(outputByMode);
    if (!saved.ok) {
      throw createWebCapRuntimeError(saved.error);
    }
    return saved.value.outputByMode;
  }

  async reset(): Promise<PopupSettingsSnapshot> {
    const [capture, outputs] = await Promise.all([this.capture.reset(), this.outputs.reset()]);
    if (!capture.ok) {
      throw createWebCapRuntimeError(capture.error);
    }
    if (!outputs.ok) {
      throw createWebCapRuntimeError(outputs.error);
    }
    return { capture: capture.value, outputByMode: outputs.value.outputByMode };
  }
}

export function selectedImageFormat(
  outputByMode: ModeOutputPreferences = DEFAULT_MODE_OUTPUT_PREFERENCES,
  mode: CaptureMode,
): ImageFormat {
  return imageFormatForMode(outputByMode, mode);
}
