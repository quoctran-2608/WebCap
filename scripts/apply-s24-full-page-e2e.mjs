import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const path = "tests/e2e/full-page-capture.spec.ts";
let source = readFileSync(path, "utf8");

source = replaceOnce(
  source,
  `    activeEngine?: string;\n    completedTiles: number;`,
  `    activeEngine?: string;\n    activeOutputFormat?: string;\n    outputArtifactId?: string;\n    output?: {\n      artifactId: string;\n      format: string;\n      mimeType: string;\n      byteLength: number;\n      pageCount?: number;\n    };\n    completedTiles: number;`,
  "stored state output fields",
);

source = replaceOnce(
  source,
  `      activeEngine?: string;\n      completedTiles: number;`,
  `      activeEngine?: string;\n      activeOutputFormat?: string;\n      outputArtifactId?: string;\n      output?: {\n        artifactId: string;\n        format: string;\n        mimeType: string;\n        byteLength: number;\n        pageCount?: number;\n      };\n      completedTiles: number;`,
  "database job output fields",
);

source = replaceOnce(
  source,
  `              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),\n              completedTiles: job.completedTiles,`,
  `              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),\n              ...(job.activeOutputFormat === undefined\n                ? {}\n                : { activeOutputFormat: job.activeOutputFormat }),\n              ...(job.outputArtifactId === undefined\n                ? {}\n                : { outputArtifactId: job.outputArtifactId }),\n              ...(job.output === undefined ? {} : { output: job.output }),\n              completedTiles: job.completedTiles,`,
  "serialized output fields",
);

source = replaceOnce(
  source,
  `  await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();\n  await expect(popup.getByText("Tile set toàn trang đã sẵn sàng.")).toBeVisible({\n    timeout: 45_000,\n  });\n\n  const state = await readFullPageState(serviceWorker);\n  expect(state.job).toMatchObject({\n    state: "ready",\n    activeEngine: "scroll",\n    cleanupCompleted: true,\n  });`,
  `  await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();\n  const result = popup.getByTestId("tiled-output-result");\n  await expect(result).toBeVisible({ timeout: 45_000 });\n  await expect(result).toHaveAttribute("data-format", "pdf");\n  await expect(result.getByRole("heading", { name: "PDF đã sẵn sàng" })).toBeVisible();\n  await expect(result.getByRole("button", { name: "Tải xuống" })).toBeVisible();\n  await expect(result.getByRole("button", { name: "Mở trình biên tập PDF" })).toBeVisible();\n\n  const state = await readFullPageState(serviceWorker);\n  expect(state.job).toMatchObject({\n    state: "completed",\n    activeEngine: "scroll",\n    activeOutputFormat: "pdf",\n    cleanupCompleted: true,\n    outputArtifactId: expect.any(String),\n    output: {\n      artifactId: expect.any(String),\n      format: "pdf",\n      mimeType: "application/pdf",\n      byteLength: expect.any(Number),\n      pageCount: expect.any(Number),\n    },\n  });\n  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n  expect(state.job?.output?.byteLength).toBeGreaterThan(0);\n  expect(state.job?.output?.pageCount).toBeGreaterThan(0);`,
  "full-page S24 result expectations",
);

writeFileSync(path, source);
