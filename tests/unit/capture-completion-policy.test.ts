import { describe, expect, it } from "vitest";

import { createCaptureCompletionPolicy } from "@background/capture-completion-policy";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

describe("createCaptureCompletionPolicy", () => {
  it("auto-exports full-page and scroll-area captures as PDF", () => {
    expect(createCaptureCompletionPolicy("full-page", DEFAULT_CAPTURE_SETTINGS)).toEqual({
      primaryOutput: "pdf",
      autoExport: true,
      openEditorAfterCapture: false,
      allowGuardedImageFallback: false,
    });
    expect(createCaptureCompletionPolicy("scroll-area", DEFAULT_CAPTURE_SETTINGS)).toEqual({
      primaryOutput: "pdf",
      autoExport: true,
      openEditorAfterCapture: false,
      allowGuardedImageFallback: true,
    });
  });

  it("auto-exports region and element captures using a guarded image format", () => {
    const jpegSettings = { ...DEFAULT_CAPTURE_SETTINGS, outputFormat: "jpeg" as const };
    expect(createCaptureCompletionPolicy("region", jpegSettings)).toMatchObject({
      primaryOutput: "jpeg",
      autoExport: true,
      allowGuardedImageFallback: true,
    });
    expect(createCaptureCompletionPolicy("element", jpegSettings)).toMatchObject({
      primaryOutput: "jpeg",
      autoExport: true,
      allowGuardedImageFallback: true,
    });
  });

  it("uses PNG instead of treating a targeted PDF preference as an image format", () => {
    const pdfSettings = { ...DEFAULT_CAPTURE_SETTINGS, outputFormat: "pdf" as const };
    expect(createCaptureCompletionPolicy("region", pdfSettings).primaryOutput).toBe("png");
    expect(createCaptureCompletionPolicy("element", pdfSettings).primaryOutput).toBe("png");
  });

  it("keeps visible capture on the existing non-automatic image flow", () => {
    expect(createCaptureCompletionPolicy("visible", DEFAULT_CAPTURE_SETTINGS)).toMatchObject({
      primaryOutput: "png",
      autoExport: false,
      allowGuardedImageFallback: false,
    });
  });

  it("normalizes a visible PDF preference to PNG without enabling automatic export", () => {
    const pdfSettings = { ...DEFAULT_CAPTURE_SETTINGS, outputFormat: "pdf" as const };
    expect(createCaptureCompletionPolicy("visible", pdfSettings)).toMatchObject({
      primaryOutput: "png",
      autoExport: false,
      allowGuardedImageFallback: false,
    });
  });
});
