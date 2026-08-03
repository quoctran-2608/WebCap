import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected text not found in ${path}: ${before.slice(0, 180)}`);
  }
  await writeFile(path, source.replace(before, after), "utf8");
}

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `      async cleanup(job) {
        if (job.mode !== "full-page" && job.mode !== "region") {
          return;
        }
        let scrollCleanupError: unknown;`,
  `      async cleanup(job) {
        if (job.mode !== "full-page" && job.mode !== "region") {
          return;
        }
        if (job.mode === "region" && job.targetRect === undefined) {
          return;
        }
        let scrollCleanupError: unknown;`,
);

await replaceOnce(
  "tests/e2e/region-selection.spec.ts",
  `  await targetPage.locator("#focus-target").focus();
  const before = await snapshotPage(targetPage);
  const popup = await openPopup();`,
  `  await targetPage.locator("#focus-target").focus();
  const tabId = await resolveTab(serviceWorker, targetPage);
  const before = await snapshotPage(targetPage);
  const popup = await openPopup();`,
);

await replaceOnce(
  "tests/e2e/region-selection.spec.ts",
  `  await popup.bringToFront();
  await popup.reload();
  await expect(popup.getByText("Tile set vùng chọn đã sẵn sàng.")).toBeVisible();`,
  `  await targetPage.bringToFront();
  await serviceWorker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.getByText("Tile set vùng chọn đã sẵn sàng.")).toBeVisible();`,
);

await replaceOnce(
  "scripts/build-content-script.mjs",
  `    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
`,
  "",
);
