import { describe, expect, it } from "vitest";

import {
  loadCaptureSettingsForNewJob,
  type CaptureSettingsLoader,
} from "@popup/capture-settings";
import { createWebCapError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

describe("loadCaptureSettingsForNewJob", () => {
  it("preserves every stored option while applying the selected image format", async () => {
    const stored = {
      ...DEFAULT_CAPTURE_SETTINGS,
      outputFormat: "jpeg" as const,
      imageQuality: 0.73,
      fixedElementMode: "remove" as const,
      lazyLoad: {
        ...DEFAULT_CAPTURE_SETTINGS.lazyLoad,
        settleMs: 1_250,
      },
      limits: {
        ...DEFAULT_CAPTURE_SETTINGS.limits,
        maxTiles: 321,
      },
      pdf: {
        pageSize: "letter" as const,
        orientation: "landscape" as const,
        marginMm: 12,
        jpegQuality: 0.81,
      },
    };
    const loader: CaptureSettingsLoader = {
      load: () => Promise.resolve({ ok: true, value: stored }),
    };

    await expect(loadCaptureSettingsForNewJob("webp", loader)).resolves.toEqual({
      ...stored,
      outputFormat: "webp",
    });
  });

  it("surfaces a typed storage error instead of silently using defaults", async () => {
    const error = createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "Stored settings could not be read.",
      userMessageKey: "errors.settingsRead",
      retryable: true,
      fallbackAllowed: true,
    });
    const loader: CaptureSettingsLoader = {
      load: () => Promise.resolve({ ok: false, error }),
    };

    await expect(loadCaptureSettingsForNewJob("png", loader)).rejects.toMatchObject({
      data: { code: "E_STORAGE_READ", stage: "storage" },
    });
  });
});
