import { readFile, rm, writeFile } from "node:fs/promises";

function replaceUnique(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`S22 browser-fix anchor is missing or not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const selectorPath = "src/content/region-selector.ts";
let selector = await readFile(selectorPath, "utf8");
selector = replaceUnique(
  selector,
  `      .toolbar {\n        position: fixed;\n        top: 14px;`,
  `      .toolbar {\n        position: fixed;\n        z-index: 4;\n        top: 14px;`,
  "toolbar stacking layer",
);
selector = replaceUnique(
  selector,
  `      .selection {\n        position: fixed;\n        display: none;`,
  `      .selection {\n        position: fixed;\n        z-index: 2;\n        display: none;`,
  "selection stacking layer",
);
await writeFile(selectorPath, selector, "utf8");

const regionSpecPath = "tests/e2e/region-selection.spec.ts";
let regionSpec = await readFile(regionSpecPath, "utf8");
regionSpec = replaceUnique(
  regionSpec,
  `    await serviceWorker.evaluate(async (id) => chrome.tabs.setZoom(id, 1), tabId);`,
  `    await serviceWorker\n      .evaluate(async (id) => chrome.tabs.setZoom(id, 1), tabId)\n      .catch(() => undefined);`,
  "DPR zoom cleanup",
);
await writeFile(regionSpecPath, regionSpec, "utf8");

const accessibilityPath = "tests/e2e/region-selector-accessibility.spec.ts";
let accessibility = await readFile(accessibilityPath, "utf8");
accessibility += `

test("@smoke auto-scrolls horizontally and restores the page after cancellation", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/region-selection.html");
  await targetPage.evaluate(() => {
    document.documentElement.style.minWidth = "2400px";
    document.body.style.minWidth = "2400px";
  });
  const before = await targetPage.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const root = await launchRegionSelector(await openPopup(), targetPage);
  const jobId = await latestRegionJobId(serviceWorker);
  const viewport = targetPage.viewportSize();
  if (viewport === null) throw new Error("Region fixture viewport is unavailable.");

  await targetPage.mouse.move(180, 260);
  await targetPage.mouse.down();
  await targetPage.mouse.move(viewport.width - 2, 360, { steps: 16 });
  await expect.poll(() => targetPage.evaluate(() => window.scrollX)).toBeGreaterThan(100);
  await targetPage.mouse.up();
  await targetPage.keyboard.press("Escape");

  await expect(root).toHaveCount(0);
  await waitForRegionState(serviceWorker, jobId, "cancelled");
  await expect
    .poll(() => targetPage.evaluate(() => ({ x: window.scrollX, y: window.scrollY })))
    .toEqual(before);
});

test("@smoke removes the job and tab lease when selector injection fails", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/region-selection.html");
  const popup = await openPopup();
  await popup.getByRole("button", { name: /^Vùng tự chọn/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp vùng tự chọn" })).toBeVisible();
  await targetPage.close();

  await popup.getByRole("button", { name: "Bắt đầu chọn vùng" }).click();
  await expect(popup.getByRole("alert")).toBeVisible({ timeout: 10_000 });
  await expect(popup).not.toBeClosed();

  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("webcap-db", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("Unable to open database."));
        });
        const jobs = await new Promise<Array<{ mode?: string }>>((resolve, reject) => {
          const transaction = database.transaction("jobs", "readonly");
          const request = transaction.objectStore("jobs").getAll();
          request.onsuccess = () => resolve(request.result as Array<{ mode?: string }>);
          request.onerror = () => reject(request.error ?? new Error("Unable to read jobs."));
        });
        database.close();
        const stored = await chrome.storage.session.get("webcap.jobs.session");
        const state = stored["webcap.jobs.session"] as
          | { summaries?: unknown[]; locks?: unknown[] }
          | undefined;
        return {
          regionJobs: jobs.filter((job) => job.mode === "region").length,
          summaries: state?.summaries?.length ?? 0,
          locks: state?.locks?.length ?? 0,
        };
      }),
    )
    .toEqual({ regionJobs: 0, summaries: 0, locks: 0 });
});
`;
await writeFile(accessibilityPath, accessibility, "utf8");

await rm("scripts/s22-browser-fix.mjs", { force: true });
