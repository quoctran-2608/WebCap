import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const path = "tests/e2e/element-selection.spec.ts";
let source = readFileSync(path, "utf8");

source = replaceOnce(
  source,
  `  const root = targetPage.locator("[data-webcap-element-selector]");\n  await expect(root).toHaveCount(1);\n  const child = targetPage.locator("#target-child");`,
  `  const root = targetPage.locator("[data-webcap-element-selector]");\n  await expect(root).toHaveCount(1);\n  const tabId = await resolveTab(serviceWorker, targetPage);\n  const child = targetPage.locator("#target-child");`,
  "normal element tab id",
);

source = replaceOnce(
  source,
  `  const result = popup.getByTestId("tiled-output-result");\n  await expect(result).toBeVisible({ timeout: 45_000 });\n  await expect(result).toHaveAttribute("data-format", "png");\n  await expect(result.getByRole("heading", { name: "Ảnh đã sẵn sàng" })).toBeVisible();\n\n  const state = await waitForElementState(serviceWorker, "completed");`,
  `  const state = await waitForElementState(serviceWorker, "completed");`,
  "remove stale normal popup assertion",
);

source = replaceOnce(
  source,
  `  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n  expect(state.job?.output?.byteLength).toBeGreaterThan(0);\n  expect(state.job?.targetRect).toMatchObject({`,
  `  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n  expect(state.job?.output?.byteLength).toBeGreaterThan(0);\n\n  await targetPage.bringToFront();\n  await serviceWorker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);\n  const resultPopup = await openPopup();\n  const result = resultPopup.getByTestId("tiled-output-result");\n  await expect(result).toBeVisible({ timeout: 15_000 });\n  await expect(result).toHaveAttribute("data-format", "png");\n  await expect(result.getByRole("heading", { name: "Ảnh đã sẵn sàng" })).toBeVisible();\n\n  expect(state.job?.targetRect).toMatchObject({`,
  "normal element fresh popup assertion",
);

source = replaceOnce(
  source,
  `  await targetPage.goto("http://127.0.0.1:4174/element-selection.html");\n  const shadowButton = targetPage.locator("open-shadow-card").locator("#shadow-action");`,
  `  await targetPage.goto("http://127.0.0.1:4174/element-selection.html");\n  const tabId = await resolveTab(serviceWorker, targetPage);\n  const shadowButton = targetPage.locator("open-shadow-card").locator("#shadow-action");`,
  "shadow element tab id",
);

source = replaceOnce(
  source,
  `  const result = popup.getByTestId("tiled-output-result");\n  await expect(result).toBeVisible({ timeout: 45_000 });\n  await expect(result).toHaveAttribute("data-format", "png");\n\n  const state = await waitForElementState(serviceWorker, "completed");`,
  `  const state = await waitForElementState(serviceWorker, "completed");`,
  "remove stale shadow popup assertion",
);

source = replaceOnce(
  source,
  `  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n  expect(state.job?.descriptor).toMatchObject({`,
  `  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n\n  await targetPage.bringToFront();\n  await serviceWorker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);\n  const resultPopup = await openPopup();\n  const result = resultPopup.getByTestId("tiled-output-result");\n  await expect(result).toBeVisible({ timeout: 15_000 });\n  await expect(result).toHaveAttribute("data-format", "png");\n\n  expect(state.job?.descriptor).toMatchObject({`,
  "shadow element fresh popup assertion",
);

writeFileSync(path, source);
