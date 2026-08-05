import { readFile, writeFile } from "node:fs/promises";

const path = "tests/e2e/adaptive-scroll.spec.ts";
let source = await readFile(path, "utf8");
source = source.replace(
  'import type { BrowserContext, Page, Worker } from "@playwright/test";',
  'import type { Page, Worker } from "@playwright/test";',
);
source = source.replace(
  `interface WorkerRestartEvidence {
  previousTargetId: string;
  restartedTargetId: string;
}`,
  `interface WorkerRestartEvidence {
  previousWorkerStopped: boolean;
  wakeResponseType: string;
}`,
);

const helperStart = source.indexOf("async function restartExtensionWorker(");
const helperEnd = source.indexOf(
  '\ntest("@smoke captures a real page beyond 100k CSS pixels without the legacy height cap"',
  helperStart,
);
if (helperStart < 0 || helperEnd < 0) {
  throw new Error("Unable to locate the S23 restart helper.");
}
const helper = `async function restartExtensionWorker(
  worker: Worker,
  popup: Page,
  targetPage: Page,
  jobId: string,
): Promise<WorkerRestartEvidence> {
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => undefined);
  await expect
    .poll(
      () => worker.evaluate(() => true).then(() => false, () => true),
      { timeout: 10_000 },
    )
    .toBe(true);

  await popup.reload({ waitUntil: "domcontentloaded" });
  await targetPage.bringToFront();
  const wakeRequest = createJobGetMessage({
    requestId: crypto.randomUUID(),
    jobId,
    sentAt: new Date().toISOString(),
  });
  const wakeResponse: unknown = await popup.evaluate(async (message) => {
    const result: unknown = await chrome.runtime.sendMessage(message);
    return result;
  }, wakeRequest);
  if (
    typeof wakeResponse !== "object" ||
    wakeResponse === null ||
    !("type" in wakeResponse) ||
    wakeResponse.type !== "JOB_RESPONSE"
  ) {
    throw new Error(\`The restarted extension runtime returned an invalid response: \${JSON.stringify(
      wakeResponse,
    )}\`);
  }
  await targetPage.bringToFront();
  return { previousWorkerStopped: true, wakeResponseType: wakeResponse.type };
}
`;
source = source.slice(0, helperStart) + helper + source.slice(helperEnd);
source = source.replace(
  `test("@smoke resumes the persisted prefix after an extension service-worker reload", async ({
  context,
  extensionId,
  serviceWorker,`,
  `test("@smoke resumes the persisted prefix after an extension service-worker reload", async ({
  serviceWorker,`,
);
source = source.replace(
  `  const restart = await restartExtensionWorker(context, extensionId, popup, targetPage, jobId);
  expect(restart.restartedTargetId).not.toBe(restart.previousTargetId);`,
  `  const restart = await restartExtensionWorker(serviceWorker, popup, targetPage, jobId);
  expect(restart).toEqual({ previousWorkerStopped: true, wakeResponseType: "JOB_RESPONSE" });`,
);
await writeFile(path, source, "utf8");
