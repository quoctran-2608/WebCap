import { readFile, writeFile } from "node:fs/promises";

async function replaceInFile(fileName, before, after) {
  const source = await readFile(fileName, "utf8");
  if (source.includes(before)) {
    await writeFile(fileName, source.replace(before, after), "utf8");
    return;
  }
  if (!source.includes(after)) {
    throw new Error(`Expected S08 lint pattern was not found in ${fileName}.`);
  }
}

await replaceInFile(
  "src/background/page-preparation-service.ts",
  `    if (cleanupError !== undefined) {
      throw cleanupError;
    }`,
  `    if (cleanupError !== undefined) {
      if (cleanupError instanceof Error) {
        throw cleanupError;
      }
      throw createWebCapRuntimeError(
        normalizeError(cleanupError, {
          code: "E_CLEANUP_PARTIAL",
          stage: "cleanup",
          userMessageKey: "errors.cleanupPartial",
          retryable: true,
          fallbackAllowed: false,
        }),
      );
    }`,
);

await replaceInFile(
  "tests/e2e/page-preparation.spec.ts",
  `async function sendContentMessage(
  serviceWorker: Worker,
  tabId: number,
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return serviceWorker.evaluate(
    async ({ id, payload }) => await chrome.tabs.sendMessage<Record<string, unknown>>(id, payload),
    { id: tabId, payload: message },
  );
}`,
  `async function sendContentMessage(
  serviceWorker: Worker,
  tabId: number,
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return serviceWorker.evaluate(
    async ({ id, payload }) => {
      const response: unknown = await chrome.tabs.sendMessage(id, payload);
      if (typeof response !== "object" || response === null) {
        throw new TypeError("The content script returned a non-object response.");
      }
      return response as Record<string, unknown>;
    },
    { id: tabId, payload: message },
  );
}`,
);

await replaceInFile(
  "tests/e2e/page-preparation.spec.ts",
  `    async ({ id, prepare, cancel }) => {
      const pending = chrome.tabs.sendMessage<Record<string, unknown>>(id, prepare);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const cancelResponse = await chrome.tabs.sendMessage<Record<string, unknown>>(id, cancel);
      const prepareResponse = await pending;
      return { cancelResponse, prepareResponse };
    },`,
  `    async ({ id, prepare, cancel }) => {
      const pending: Promise<unknown> = chrome.tabs.sendMessage(id, prepare);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const cancelResponse: unknown = await chrome.tabs.sendMessage(id, cancel);
      const prepareResponse: unknown = await pending;
      if (
        typeof cancelResponse !== "object" ||
        cancelResponse === null ||
        typeof prepareResponse !== "object" ||
        prepareResponse === null
      ) {
        throw new TypeError("The content script returned a non-object response.");
      }
      return {
        cancelResponse: cancelResponse as Record<string, unknown>,
        prepareResponse: prepareResponse as Record<string, unknown>,
      };
    },`,
);
