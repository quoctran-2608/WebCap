import { describe, expect, it } from "vitest";

import { captureSettingsForOutput } from "@popup/capture-settings";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

describe("captureSettingsForOutput", () => {
  it("preserves every loaded option while applying the selected image format", () => {
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

    expect(captureSettingsForOutput(stored, "webp")).toEqual({
      ...stored,
      outputFormat: "webp",
    });
    expect(stored.outputFormat).toBe("jpeg");
  });
});
