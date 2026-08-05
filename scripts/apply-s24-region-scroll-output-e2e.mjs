import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function replaceCount(source, needle, replacement, expected, label) {
  const matches = source.split(needle).length - 1;
  if (matches !== expected) {
    throw new Error(`${label}: expected ${expected} matches, received ${matches}`);
  }
  return source.split(needle).join(replacement);
}

const regionPath = "tests/e2e/region-selection.spec.ts";
let region = readFileSync(regionPath, "utf8");
region = replaceOnce(
  region,
  `    activeEngine?: string;\n    completedTiles: number;`,
  `    activeEngine?: string;\n    activeOutputFormat?: string;\n    outputArtifactId?: string;\n    output?: {\n      artifactId: string;\n      format: string;\n      mimeType: string;\n      byteLength: number;\n    };\n    completedTiles: number;`,
  "region state output fields",
);
region = replaceOnce(
  region,
  `      activeEngine?: string;\n      completedTiles: number;`,
  `      activeEngine?: string;\n      activeOutputFormat?: string;\n      outputArtifactId?: string;\n      output?: {\n        artifactId: string;\n        format: string;\n        mimeType: string;\n        byteLength: number;\n      };\n      completedTiles: number;`,
  "stored region output fields",
);
region = replaceOnce(
  region,
  `              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),\n              completedTiles: job.completedTiles,`,
  `              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),\n              ...(job.activeOutputFormat === undefined\n                ? {}\n                : { activeOutputFormat: job.activeOutputFormat }),\n              ...(job.outputArtifactId === undefined\n                ? {}\n                : { outputArtifactId: job.outputArtifactId }),\n              ...(job.output === undefined ? {} : { output: job.output }),\n              completedTiles: job.completedTiles,`,
  "serialized region output fields",
);
region = replaceOnce(
  region,
  `async function waitForRegionReady(serviceWorker: Worker): Promise<RegionState> {`,
  `async function waitForRegionCompleted(serviceWorker: Worker): Promise<RegionState> {`,
  "region helper name",
);
region = replaceOnce(
  region,
  `    .toBe("ready");\n  return readRegionState(serviceWorker);`,
  `    .toBe("completed");\n  return readRegionState(serviceWorker);`,
  "region completed state",
);
region = replaceCount(
  region,
  `waitForRegionReady(serviceWorker)`,
  `waitForRegionCompleted(serviceWorker)`,
  2,
  "region helper calls",
);
region = replaceOnce(
  region,
  `  expect(state.job).toMatchObject({\n    state: "ready",\n    activeEngine: "cdp",\n    cleanupCompleted: true,\n  });`,
  `  expect(state.job).toMatchObject({\n    state: "completed",\n    activeEngine: "cdp",\n    activeOutputFormat: "png",\n    cleanupCompleted: true,\n    outputArtifactId: expect.any(String),\n    output: {\n      artifactId: expect.any(String),\n      format: "png",\n      mimeType: "image/png",\n      byteLength: expect.any(Number),\n    },\n  });\n  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n  expect(state.job?.output?.byteLength).toBeGreaterThan(0);`,
  "region PNG output expectations",
);
region = replaceOnce(
  region,
  `  const restoredPopup = await openPopup();\n  await expect(restoredPopup.getByText("Tile set vùng chọn đã sẵn sàng.")).toBeVisible();`,
  `  const restoredPopup = await openPopup();\n  const result = restoredPopup.getByTestId("tiled-output-result");\n  await expect(result).toBeVisible({ timeout: 15_000 });\n  await expect(result).toHaveAttribute("data-format", "png");\n  await expect(result.getByRole("heading", { name: "Ảnh đã sẵn sàng" })).toBeVisible();`,
  "region fresh popup result",
);
writeFileSync(regionPath, region);

const scrollPath = "tests/e2e/scroll-area.spec.ts";
let scroll = readFileSync(scrollPath, "utf8");
scroll = replaceOnce(
  scroll,
  `    activeEngine?: string;\n    completedTiles: number;`,
  `    activeEngine?: string;\n    activeOutputFormat?: string;\n    outputArtifactId?: string;\n    output?: {\n      artifactId: string;\n      format: string;\n      mimeType: string;\n      byteLength: number;\n      pageCount?: number;\n    };\n    completedTiles: number;`,
  "scroll-area state output fields",
);
scroll = replaceOnce(
  scroll,
  `      activeEngine?: string;\n      completedTiles: number;`,
  `      activeEngine?: string;\n      activeOutputFormat?: string;\n      outputArtifactId?: string;\n      output?: {\n        artifactId: string;\n        format: string;\n        mimeType: string;\n        byteLength: number;\n        pageCount?: number;\n      };\n      completedTiles: number;`,
  "stored scroll-area output fields",
);
scroll = replaceOnce(
  scroll,
  `              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),\n              completedTiles: job.completedTiles,`,
  `              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),\n              ...(job.activeOutputFormat === undefined\n                ? {}\n                : { activeOutputFormat: job.activeOutputFormat }),\n              ...(job.outputArtifactId === undefined\n                ? {}\n                : { outputArtifactId: job.outputArtifactId }),\n              ...(job.output === undefined ? {} : { output: job.output }),\n              completedTiles: job.completedTiles,`,
  "serialized scroll-area output fields",
);
scroll = replaceOnce(
  scroll,
  `async function startScrollAreaSelection(popup: Page): Promise<void> {`,
  `async function resolveTab(serviceWorker: Worker, page: Page): Promise<number> {\n  return serviceWorker.evaluate(async (url) => {\n    const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);\n    if (tab?.id === undefined) {\n      throw new Error("The scroll-area fixture tab could not be resolved.");\n    }\n    return tab.id;\n  }, page.url());\n}\n\nasync function startScrollAreaSelection(popup: Page): Promise<void> {`,
  "scroll-area tab resolver",
);
scroll = replaceCount(
  scroll,
  `waitForState(serviceWorker, "ready")`,
  `waitForState(serviceWorker, "completed")`,
  2,
  "scroll-area completed helper calls",
);
scroll = replaceOnce(
  scroll,
  `  const target = targetPage.locator("#nested-scroll");`,
  `  const tabId = await resolveTab(serviceWorker, targetPage);\n  const target = targetPage.locator("#nested-scroll");`,
  "nested scroll tab id",
);
scroll = replaceOnce(
  scroll,
  `  expect(state.job).toMatchObject({\n    state: "ready",\n    activeEngine: "scroll",\n    cleanupCompleted: true,\n    targetRect: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },\n    descriptor: { captureKind: "full-scroll-content", scrollable: true },\n  });`,
  `  expect(state.job).toMatchObject({\n    state: "completed",\n    activeEngine: "scroll",\n    activeOutputFormat: "pdf",\n    cleanupCompleted: true,\n    outputArtifactId: expect.any(String),\n    output: {\n      artifactId: expect.any(String),\n      format: "pdf",\n      mimeType: "application/pdf",\n      byteLength: expect.any(Number),\n      pageCount: expect.any(Number),\n    },\n    targetRect: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },\n    descriptor: { captureKind: "full-scroll-content", scrollable: true },\n  });\n  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n  expect(state.job?.output?.byteLength).toBeGreaterThan(0);\n  expect(state.job?.output?.pageCount).toBeGreaterThan(0);`,
  "nested scroll PDF output expectations",
);
scroll = replaceOnce(
  scroll,
  `  expect(after).toEqual(before);\n});`,
  `  expect(after).toEqual(before);\n\n  await targetPage.bringToFront();\n  await serviceWorker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);\n  const resultPopup = await openPopup();\n  const result = resultPopup.getByTestId("tiled-output-result");\n  await expect(result).toBeVisible({ timeout: 15_000 });\n  await expect(result).toHaveAttribute("data-format", "pdf");\n  await expect(result.getByRole("heading", { name: "PDF đã sẵn sàng" })).toBeVisible();\n});`,
  "nested scroll fresh popup result",
);
scroll = replaceOnce(
  scroll,
  `  const state = await waitForState(serviceWorker, "completed");\n  expect(state.job?.targetRect).toEqual({ x: 0, y: 0, width: before.width, height: before.height });`,
  `  const state = await waitForState(serviceWorker, "completed");\n  expect(state.job).toMatchObject({\n    state: "completed",\n    activeOutputFormat: "pdf",\n    outputArtifactId: expect.any(String),\n    output: {\n      artifactId: expect.any(String),\n      format: "pdf",\n      mimeType: "application/pdf",\n      byteLength: expect.any(Number),\n      pageCount: expect.any(Number),\n    },\n  });\n  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n  expect(state.job?.targetRect).toEqual({ x: 0, y: 0, width: before.width, height: before.height });`,
  "wide scroll PDF output expectations",
);
writeFileSync(scrollPath, scroll);
