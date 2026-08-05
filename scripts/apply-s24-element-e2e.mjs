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
  `    activeEngine?: string;\n    completedTiles: number;`,
  `    activeEngine?: string;\n    activeOutputFormat?: string;\n    outputArtifactId?: string;\n    output?: {\n      artifactId: string;\n      format: string;\n      mimeType: string;\n      byteLength: number;\n    };\n    completedTiles: number;`,
  "element state output fields",
);

source = replaceOnce(
  source,
  `      activeEngine?: string;\n      completedTiles: number;`,
  `      activeEngine?: string;\n      activeOutputFormat?: string;\n      outputArtifactId?: string;\n      output?: {\n        artifactId: string;\n        format: string;\n        mimeType: string;\n        byteLength: number;\n      };\n      completedTiles: number;`,
  "database element output fields",
);

source = replaceOnce(
  source,
  `              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),\n              completedTiles: job.completedTiles,`,
  `              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),\n              ...(job.activeOutputFormat === undefined\n                ? {}\n                : { activeOutputFormat: job.activeOutputFormat }),\n              ...(job.outputArtifactId === undefined\n                ? {}\n                : { outputArtifactId: job.outputArtifactId }),\n              ...(job.output === undefined ? {} : { output: job.output }),\n              completedTiles: job.completedTiles,`,
  "serialized element output fields",
);

source = replaceOnce(
  source,
  `  await targetPage.keyboard.press("Enter");\n  await expect(root).toHaveCount(0);\n\n  const state = await waitForElementState(serviceWorker, "ready");\n  expect(state.job).toMatchObject({\n    state: "ready",\n    activeEngine: "cdp",\n    cleanupCompleted: true,`,
  `  await targetPage.keyboard.press("Enter");\n  await expect(root).toHaveCount(0);\n\n  const result = popup.getByTestId("tiled-output-result");\n  await expect(result).toBeVisible({ timeout: 45_000 });\n  await expect(result).toHaveAttribute("data-format", "png");\n  await expect(result.getByRole("heading", { name: "Ảnh đã sẵn sàng" })).toBeVisible();\n\n  const state = await waitForElementState(serviceWorker, "completed");\n  expect(state.job).toMatchObject({\n    state: "completed",\n    activeEngine: "cdp",\n    activeOutputFormat: "png",\n    cleanupCompleted: true,\n    outputArtifactId: expect.any(String),\n    output: {\n      artifactId: expect.any(String),\n      format: "png",\n      mimeType: "image/png",\n      byteLength: expect.any(Number),\n    },`,
  "normal element S24 output expectations",
);

source = replaceOnce(
  source,
  `  expect(state.job?.targetRect).toMatchObject({\n    x: childBox.x,`,
  `  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n  expect(state.job?.output?.byteLength).toBeGreaterThan(0);\n  expect(state.job?.targetRect).toMatchObject({\n    x: childBox.x,`,
  "normal element artifact invariants",
);

source = replaceOnce(
  source,
  `  await targetPage.keyboard.press("Enter");\n\n  const state = await waitForElementState(serviceWorker, "ready");\n  expect(state.job?.descriptor).toMatchObject({`,
  `  await targetPage.keyboard.press("Enter");\n\n  const result = popup.getByTestId("tiled-output-result");\n  await expect(result).toBeVisible({ timeout: 45_000 });\n  await expect(result).toHaveAttribute("data-format", "png");\n\n  const state = await waitForElementState(serviceWorker, "completed");\n  expect(state.job).toMatchObject({\n    state: "completed",\n    activeOutputFormat: "png",\n    outputArtifactId: expect.any(String),\n    output: {\n      artifactId: expect.any(String),\n      format: "png",\n      mimeType: "image/png",\n      byteLength: expect.any(Number),\n    },\n  });\n  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n  expect(state.job?.descriptor).toMatchObject({`,
  "shadow element S24 output expectations",
);

writeFileSync(path, source);
