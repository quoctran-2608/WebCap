import { describe, expect, it, vi } from "vitest";

import { PopupSettingsClient, selectedImageFormat } from "@popup/settings-client";
import { DEFAULT_POPUP_PREFERENCES } from "@shared/popup-preferences";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

describe("PopupSettingsClient", () => {
  it("loads capture settings and per-mode outputs together", async () => {
    const capture = {
      load: vi.fn(() => Promise.resolve({ ok: true as const, value: DEFAULT_CAPTURE_SETTINGS })),
      save: vi.fn(),
      reset: vi.fn(),
    };
    const outputs = {
      load: vi.fn(() => Promise.resolve({ ok: true as const, value: DEFAULT_POPUP_PREFERENCES })),
      saveOutputByMode: vi.fn(),
      reset: vi.fn(),
    };
    const client = new PopupSettingsClient(capture, outputs);

    await expect(client.load()).resolves.toEqual({
      capture: DEFAULT_CAPTURE_SETTINGS,
      outputByMode: DEFAULT_POPUP_PREFERENCES.outputByMode,
    });
    expect(capture.load).toHaveBeenCalledTimes(1);
    expect(outputs.load).toHaveBeenCalledTimes(1);
  });

  it("updates only the selected image mode output", async () => {
    const capture = {
      load: vi.fn(),
      save: vi.fn(),
      reset: vi.fn(),
    };
    const outputs = {
      load: vi.fn(),
      saveOutputByMode: vi.fn((outputByMode) =>
        Promise.resolve({
          ok: true as const,
          value: { ...DEFAULT_POPUP_PREFERENCES, outputByMode },
        }),
      ),
      reset: vi.fn(),
    };
    const client = new PopupSettingsClient(capture, outputs);

    const updated = await client.saveModeOutput(
      DEFAULT_POPUP_PREFERENCES.outputByMode,
      "region",
      "webp",
    );

    expect(updated).toEqual({
      ...DEFAULT_POPUP_PREFERENCES.outputByMode,
      region: "webp",
    });
    expect(outputs.saveOutputByMode).toHaveBeenCalledTimes(1);
  });

  it("keeps PDF-only mode outputs locked", async () => {
    const outputs = { load: vi.fn(), saveOutputByMode: vi.fn(), reset: vi.fn() };
    const capture = { load: vi.fn(), save: vi.fn(), reset: vi.fn() };
    const client = new PopupSettingsClient(capture, outputs);

    await expect(
      client.saveModeOutput(DEFAULT_POPUP_PREFERENCES.outputByMode, "full-page", "jpeg"),
    ).resolves.toBe(DEFAULT_POPUP_PREFERENCES.outputByMode);
    expect(outputs.saveOutputByMode).not.toHaveBeenCalled();
    expect(selectedImageFormat(DEFAULT_POPUP_PREFERENCES.outputByMode, "full-page")).toBe("png");
  });
});
