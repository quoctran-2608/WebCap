import { expect, test } from "./extension.fixture";

test("@smoke keeps the main CTA ahead of localized keyboard-operable settings and help", async ({
  openPopup,
}) => {
  const popup = await openPopup();
  await popup.getByTestId("locale-select").selectOption("en");

  const extensionStatus = popup.getByTestId("extension-status-details");
  await expect(extensionStatus).not.toHaveAttribute("open", "");
  await expect(popup.getByText("Version", { exact: true })).not.toBeVisible();
  await expect(popup.getByText(/^(M1|S14|S16|S17)$/u)).toHaveCount(0);

  const details = popup.getByTestId("advanced-settings");
  const summary = details.locator("summary");
  await expect(summary).toHaveText("Advanced options");
  await expect(details).not.toHaveAttribute("open", "");

  const captureAction = popup.locator(".capture-panel > button.primary-action");
  await expect(captureAction).toBeVisible();
  const captureBox = await captureAction.boundingBox();
  const settingsBox = await details.boundingBox();
  expect(captureBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  expect(captureBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
    settingsBox?.y ?? Number.NEGATIVE_INFINITY,
  );

  await summary.focus();
  await popup.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(popup.getByRole("group", { name: "PDF" })).toBeVisible();
  await expect(popup.getByLabel("Fixed and sticky elements")).toBeVisible();
  await expect(popup.getByLabel("Page margin (mm)")).toBeVisible();

  const imageQuality = popup.getByTestId("image-quality");
  await expect(imageQuality).toHaveAccessibleName("Image quality: 90%");
  await imageQuality.focus();
  await popup.keyboard.press("ArrowLeft");
  await expect(imageQuality).toHaveValue("89");
  await expect(imageQuality).toHaveAccessibleName("Image quality: 89%");

  const save = popup.getByRole("button", { name: "Save options" });
  await save.focus();
  await popup.keyboard.press("Enter");

  const status = popup.getByRole("status");
  await expect(status).toHaveText("Options saved for new captures.");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveAttribute("aria-atomic", "true");
  await expect(save).toBeEnabled();

  const reset = popup.getByRole("button", { name: "Reset options" });
  await reset.focus();
  await popup.keyboard.press("Enter");
  await expect(status).toHaveText(
    "Default options restored. Current capture data was not changed.",
  );
  await expect(reset).toBeEnabled();
  await expect(imageQuality).toHaveValue("90");

  const privacy = popup.locator(".trust-details");
  const privacySummary = privacy.locator("summary");
  await privacySummary.focus();
  await popup.keyboard.press("Enter");
  await expect(privacy).toHaveAttribute("open", "");
});
