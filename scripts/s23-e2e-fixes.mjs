import { readFile, writeFile } from "node:fs/promises";

function replaceUnique(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`S23 E2E anchor is missing or not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

async function patchAdaptiveRestart() {
  const path = "tests/e2e/adaptive-scroll.spec.ts";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    `async function restartExtensionWorker(
  context: BrowserContext,
  extensionId: string,
  worker: Worker,
): Promise<Worker> {
  const nextWorker = context.waitForEvent("serviceworker", {
    predicate: (candidate) =>
      candidate !== worker && candidate.url().startsWith(\`chrome-extension://\${extensionId}/\`),
    timeout: 20_000,
  });
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => undefined);
  const wakePage = await context.newPage();
  await wakePage
    .goto(\`chrome-extension://\${extensionId}/popup.html\`, { waitUntil: "domcontentloaded" })
    .catch(() => undefined);
  await wakePage.close().catch(() => undefined);
  return nextWorker;
}`,
    `async function restartExtensionWorker(
  context: BrowserContext,
  extensionId: string,
  worker: Worker,
  popup: Page,
  targetPage: Page,
): Promise<Worker> {
  const session = await context.newCDPSession(popup);
  const targets = (await session.send("Target.getTargets")) as {
    targetInfos: Array<{ targetId: string; type: string; url: string }>;
  };
  const serviceWorkerTarget = targets.targetInfos.find(
    (target) =>
      target.type === "service_worker" &&
      target.url.startsWith(\`chrome-extension://\${extensionId}/\`),
  );
  if (serviceWorkerTarget === undefined) {
    throw new Error("The extension service-worker target could not be resolved.");
  }

  const nextWorker = context.waitForEvent("serviceworker", {
    predicate: (candidate) =>
      candidate !== worker && candidate.url().startsWith(\`chrome-extension://\${extensionId}/\`),
    timeout: 20_000,
  });
  await session.send("Target.closeTarget", { targetId: serviceWorkerTarget.targetId });
  await targetPage.bringToFront();
  await popup.reload({ waitUntil: "domcontentloaded" });
  await targetPage.bringToFront();
  return nextWorker;
}`,
    "adaptive worker restart helper",
  );
  source = replaceUnique(
    source,
    "  const restartedWorker = await restartExtensionWorker(context, extensionId, serviceWorker);",
    "  const restartedWorker = await restartExtensionWorker(\n    context,\n    extensionId,\n    serviceWorker,\n    popup,\n    targetPage,\n  );",
    "adaptive worker restart call",
  );
  await writeFile(path, source, "utf8");
}

async function patchHardeningGuard() {
  const path = "tests/e2e/capture-hardening.spec.ts";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    'test("shows an explicit partial warning when full-page capture reaches a height guard @smoke", async ({',
    'test("shows an explicit partial warning when adaptive capture reaches a tile guard @smoke", async ({',
    "hardening test title",
  );
  source = replaceUnique(
    source,
    '        preferredEngine: "cdp",',
    '        preferredEngine: "scroll",',
    "hardening adaptive engine",
  );
  source = replaceUnique(
    source,
    `            maxCssHeight: 1_600,
            maxCssWidth: 20_000,
            maxTiles: 256,`,
    `            maxCssHeight: 1_600,
            maxCssWidth: 20_000,
            maxTiles: 3,`,
    "hardening max tile guard",
  );
  source = replaceUnique(
    source,
    '.toBe("ready:max-css-height");',
    '.toBe("ready:max-tiles");',
    "hardening partial reason",
  );
  source = replaceUnique(
    source,
    '  await expect(popup.getByTestId("partial-capture-warning")).toContainText("giới hạn chiều cao");',
    '  await expect(popup.getByTestId("partial-capture-warning")).toContainText("giới hạn số tile");',
    "hardening partial copy",
  );
  await writeFile(path, source, "utf8");
}

async function patchPdfAssertions() {
  const editorPath = "tests/e2e/pdf-editor.spec.ts";
  let editor = await readFile(editorPath, "utf8");
  editor = replaceUnique(
    editor,
    "  expect(initialState.tileCount).toBe(2);",
    "  expect(initialState.tileCount).toBeGreaterThan(2);",
    "PDF editor adaptive tile count",
  );
  await writeFile(editorPath, editor, "utf8");

  const exportPath = "tests/e2e/pdf-export.spec.ts";
  let pdfExport = await readFile(exportPath, "utf8");
  pdfExport = replaceUnique(
    pdfExport,
    '  expect(ready.job).toMatchObject({ state: "ready", tileCount: 2 });',
    '  expect(ready.job).toMatchObject({ state: "ready" });\n  expect(ready.job?.tileCount).toBeGreaterThan(2);',
    "PDF export adaptive tile count",
  );
  await writeFile(exportPath, pdfExport, "utf8");
}

await patchAdaptiveRestart();
await patchHardeningGuard();
await patchPdfAssertions();
