import { describe, expect, it } from "vitest";

import { DEFAULT_UI_LOCALE, errorPresentation, normalizeUiLocale, t } from "@shared/i18n";
import { WebCapErrorCodeSchema } from "@shared/errors/error";

describe("UI localization", () => {
  it("defaults unknown locales to Vietnamese", () => {
    expect(normalizeUiLocale("fr")).toBe(DEFAULT_UI_LOCALE);
    expect(normalizeUiLocale(undefined)).toBe("vi");
    expect(normalizeUiLocale("en")).toBe("en");
  });

  it("interpolates parameters and keeps English/Vietnamese catalogs aligned", () => {
    expect(t("vi", "popup.stopKeep", { count: 12 })).toBe("Dừng và giữ 12 tile");
    expect(t("en", "popup.stopKeep", { count: 12 })).toBe("Stop and keep 12 tiles");
    expect(t("en", "editor.pageLabel", { page: 2, total: 5 })).toBe("Page 2 of 5");
  });

  it("provides useful localized copy for every normalized error code", () => {
    for (const code of WebCapErrorCodeSchema.options) {
      for (const locale of ["vi", "en"] as const) {
        const copy = errorPresentation(locale, code);
        expect(copy.message.length).toBeGreaterThan(8);
        expect(copy.action.length).toBeGreaterThan(8);
        expect(copy.message).not.toContain("errors.");
      }
    }
  });
});
