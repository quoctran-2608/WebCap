import { readFile, writeFile } from "node:fs/promises";

function replaceUnique(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`S23 final E2E anchor is missing or not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

async function patchRestartHarness() {
  const path = "tests/e2e/adaptive-scroll.spec.ts";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    `async function restartExtensionWorker(
  context: BrowserContext,
  extensionId: string,
  worker: Worker,
  popup: Page,`,
    `async function restartExtensionWorker(
  context: BrowserContext,
  extensionId: string,
  popup: Page,`,
    "obsolete worker parameter",
  );
  source = replaceUnique(
    source,
    `  const nextWorker = context.waitForEvent("serviceworker", {
    predicate: (candidate) =>
      candidate !== worker && candidate.url().startsWith(\`chrome-extension://\${extensionId}/\`),
    timeout: 20_000,
  });
  await session.send("Target.closeTarget", { targetId: serviceWorkerTarget.targetId });
  await targetPage.bringToFront();
  await popup.reload({ waitUntil: "domcontentloaded" });
  await targetPage.bringToFront();
  return nextWorker;`,
    `  await session.send("Target.closeTarget", { targetId: serviceWorkerTarget.targetId });
  await targetPage.bringToFront();
  await popup.reload({ waitUntil: "domcontentloaded" });
  await targetPage.bringToFront();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const refreshedTargets = (await session.send("Target.getTargets")) as {
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    };
    const restarted = refreshedTargets.targetInfos.find(
      (target) =>
        target.type === "service_worker" &&
        target.targetId !== serviceWorkerTarget.targetId &&
        target.url.startsWith(\`chrome-extension://\${extensionId}/\`),
    );
    if (restarted !== undefined) {
      const candidates = context.serviceWorkers().filter((candidate) =>
        candidate.url().startsWith(\`chrome-extension://\${extensionId}/\`),
      );
      for (const candidate of candidates) {
        const available = await candidate
          .evaluate(() => chrome.runtime.getManifest().manifest_version === 3)
          .catch(() => false);
        if (available) {
          return candidate;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The restarted extension service worker did not become observable.");`,
    "CDP restart observation",
  );
  source = replaceUnique(
    source,
    `  const restartedWorker = await restartExtensionWorker(
    context,
    extensionId,
    serviceWorker,
    popup,`,
    `  const restartedWorker = await restartExtensionWorker(
    context,
    extensionId,
    popup,`,
    "restart helper call",
  );
  await writeFile(path, source, "utf8");
}

async function patchPdfExport() {
  const path = "tests/e2e/pdf-export.spec.ts";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    `  expect(completed.job).toMatchObject({
    state: "completed",
    tileCount: 2,
  });`,
    `  expect(completed.job).toMatchObject({ state: "completed" });
  expect(completed.job?.tileCount).toBe(ready.job?.tileCount);`,
    "completed PDF adaptive tile count",
  );
  await writeFile(path, source, "utf8");
}

await patchRestartHarness();
await patchPdfExport();
