import { describe, expect, it } from "vitest";

import { WebCapErrorCodeSchema } from "@shared/errors/error";
import { DEFAULT_UI_LOCALE, errorPresentation, normalizeUiLocale, t } from "@shared/i18n";

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

  it("describes mode-aware tiled outputs in both locales", () => {
    expect(t("vi", "popup.output.pdfReady")).toBe("PDF đã sẵn sàng");
    expect(t("en", "popup.output.pdfReady")).toBe("PDF is ready");
    expect(t("vi", "popup.output.imageReady")).toBe("Ảnh đã sẵn sàng");
    expect(t("en", "popup.output.imageReady")).toBe("Image is ready");
    expect(t("vi", "popup.output.detail", { format: "PNG", bytes: "1,2 MB" })).toBe("PNG · 1,2 MB");
    expect(t("en", "popup.output.detail", { format: "PDF", bytes: "2 MB" })).toBe("PDF · 2 MB");
    expect(t("vi", "popup.output.pages", { count: 4 })).toBe("4 trang PDF");
    expect(t("en", "popup.output.pages", { count: 4 })).toBe("4 PDF pages");
    expect(t("vi", "popup.exportPdfFallback")).toBe("Chuyển sang PDF không chụp lại");
    expect(t("en", "popup.exportPdfFallback")).toBe("Switch to PDF without recapturing");
  });

  it("keeps advanced settings and reset isolation clear in both locales", () => {
    expect(t("vi", "popup.settings.summary")).toBe("Tùy chọn nâng cao");
    expect(t("en", "popup.settings.summary")).toBe("Advanced options");
    expect(t("vi", "popup.settings.imageQuality", { value: 73 })).toBe(
      "Chất lượng ảnh: 73%",
    );
    expect(t("en", "popup.settings.imageQuality", { value: 73 })).toBe(
      "Image quality: 73%",
    );
    expect(t("vi", "popup.settings.resetDone")).toContain(
      "Dữ liệu chụp hiện tại không bị thay đổi",
    );
    expect(t("en", "popup.settings.resetDone")).toContain("Current capture data was not changed");
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
