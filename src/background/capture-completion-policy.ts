import type {
  CaptureCompletionPolicy,
  CaptureJob,
  CaptureMode,
  CaptureSettings,
  OutputFormat,
} from "@shared/contracts/domain";

function selectedImageOutput(settings: CaptureSettings): OutputFormat {
  return settings.outputFormat === "pdf" ? "png" : settings.outputFormat;
}

export function createCaptureCompletionPolicy(
  mode: CaptureMode,
  settings: CaptureSettings,
): CaptureCompletionPolicy {
  if (mode === "full-page" || mode === "scroll-area") {
    return {
      primaryOutput: "pdf",
      autoExport: true,
      openEditorAfterCapture: false,
      allowGuardedImageFallback: mode === "scroll-area" && settings.outputFormat !== "pdf",
    };
  }
  if (mode === "region" || mode === "element") {
    return {
      primaryOutput: selectedImageOutput(settings),
      autoExport: true,
      openEditorAfterCapture: false,
      allowGuardedImageFallback: true,
    };
  }
  return {
    primaryOutput: selectedImageOutput(settings),
    autoExport: false,
    openEditorAfterCapture: false,
    allowGuardedImageFallback: false,
  };
}

export function completionPolicyForJob(job: CaptureJob): CaptureCompletionPolicy {
  return job.completionPolicy ?? createCaptureCompletionPolicy(job.mode, job.settings);
}
