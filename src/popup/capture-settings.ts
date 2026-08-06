import type { CaptureSettings, ImageFormat } from "@shared/contracts/domain";
import { createWebCapRuntimeError } from "@shared/errors/error";
import type { Result } from "@shared/result";
import type { WebCapErrorData } from "@shared/errors/error";
import { SettingsRepository } from "@storage/settings-repository";

export interface CaptureSettingsLoader {
  load(): Promise<Result<CaptureSettings, WebCapErrorData>>;
}

export async function loadCaptureSettingsForNewJob(
  outputFormat: ImageFormat,
  loader: CaptureSettingsLoader = new SettingsRepository(),
): Promise<CaptureSettings> {
  const loaded = await loader.load();
  if (!loaded.ok) {
    throw createWebCapRuntimeError(loaded.error);
  }

  return {
    ...loaded.value,
    outputFormat,
  };
}
