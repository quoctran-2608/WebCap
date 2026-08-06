import type { CaptureSettings, ImageFormat } from "@shared/contracts/domain";

export function captureSettingsForOutput(
  settings: CaptureSettings,
  outputFormat: ImageFormat,
): CaptureSettings {
  return {
    ...settings,
    outputFormat,
  };
}
