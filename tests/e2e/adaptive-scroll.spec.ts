import type { Page, Worker } from "@playwright/test";

import { createJobCreateMessage, createJobGetMessage } from "@shared/contracts/job-messages";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

import { expect, test } from "./extension.fixture";

interface AdaptiveJobState {
  state: string;
  completedTiles: number;
  totalTiles: number;
  targetRect: { x: number; y: number; width: number; height: number } | null;
  partialReason: string | null;
  frontier: {
    nextYCss: number;
    capturedBottomCss: number;
    observedDocumentHeightCss: number;
    capturedRows: number;
    storedBytes: number;
  } | null;
  tiles: Array<{
    index: number;
    row: number;
    status: string;
    outputRect: { x: number; y: number; width: number; height: number } | null;
    blobSize: number;
  }>;
}

interface WorkerRestartEvidence {
  previousWorkerStopped: boolean;
  wakeResponseType: string;
}

async function resolveTab(
  serviceWorker: Worker,
  page: Page,
): Promise<{ tabId: number; windowId: number }> {
  return serviceWorker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
    if (tab?.id === undefined || tab.windowId === undefined) {
      throw new Error("The adaptive fixture tab could not be resolved.");
    }
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { tabId: tab.id, windowId: tab.windowId };
  }, page.url());
}

async function createAdaptiveJob(
  popup: Page,
  target: { tabId: number; windowId: number },
  options: { maxTiles?: number; maxEstimatedBytes?: number } = {},
): Promise<string> {
  const request = createJobCreateMessage({
    requestId: crypto.randomUUID(),
    sentAt: new Date().toISOString(),
    tabId: target.tabId,
    windowId: target.windowId,
    mode: "full-page",
    preferredEngine: "scroll",
    settings: {
      ...DEFAULT_CAPTURE_SETTINGS,
      outputFormat: "png",
      lazyLoad: {
        ...DEFAULT_CAPTURE_SETTINGS.lazyLoad,
        enabled: false,
        settleMs: 0,
      },
      limits: {
        ...DEFAULT_CAPTURE_SETTINGS.limits,
        maxTiles: options.maxTiles ?? 256,
        maxEstimatedBytes:
          options.maxEstimatedBytes ?? DEFAULT_CAPTURE_SETTINGS.limits.maxEstimatedBytes,
      },
    },
  });
  const response: unknown = await popup.evaluate(async (message) => {
    const result: unknown = await chrome.runtime.sendMessage(message);
    return result;
  }, request);
  if (
    typeof response !== "object" ||
    response === null ||
    !("type" in response) ||
    response.type !== "JOB_RESPONSE" ||
    !("payload" in response)
  ) {
    throw new Error(`Adaptive job creation failed: ${JSON.stringify(response)}`);
  }
  return (response.payload as { job: { id: string } }).job.id;
}

async function readAdaptiveJobInExtension(id: string): Promise<AdaptiveJobState> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("webcap-db", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open WebCap database."));
  });
  const read = <T>(request: IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to read WebCap database."));
    });
  const transaction = database.transaction(["jobs", "tiles"], "readonly");
  const [jobValue, tileValues] = await Promise.all([
    read<unknown>(transaction.objectStore("jobs").get(id)),
    read<unknown[]>(transaction.objectStore("tiles").getAll()),
  ]);
  database.close();
  const job = jobValue as
    | {
        state: string;
        completedTiles: number;
        totalTiles: number;
        targetRect?: { x: number; y: number; width: number; height: number };
        partialCapture?: { reason: string };
        adaptiveFrontier?: {
          nextYCss: number;
          capturedBottomCss: number;
          observedDocumentHeightCss: number;
          capturedRows: number;
          storedBytes: number;
        };
      }
    | undefined;
  const tiles = (
    tileValues as Array<{
      jobId: string;
      index: number;
      tile: {
        row: number;
        status: string;
        outputRectCss?: { x: number; y: number; width: number; height: number };
      };
      blob?: Blob;
    }>
  )
    .filter((record) => record.jobId === id)
    .sort((left, right) => left.index - right.index)
    .map((record) => ({
      index: record.index,
      row: record.tile.row,
      status: record.tile.status,
      outputRect: record.tile.outputRectCss ?? null,
      blobSize: record.blob?.size ?? 0,
    }));
  if (job === undefined) {
    return {
      state: "missing",
      completedTiles: 0,
      totalTiles: 0,
      targetRect: null,
      partialReason: null,
      frontier: null,
      tiles,
    };
  }
  return {
    state: job.state,
    completedTiles: job.completedTiles,
    totalTiles: job.totalTiles,
    targetRect: job.targetRect ?? null,
    partialReason: job.partialCapture?.reason ?? null,
    frontier: job.adaptiveFrontier ?? null,
    tiles,
  };
}

async function readAdaptiveJob(serviceWorker: Worker, jobId: string): Promise<AdaptiveJobState> {
  return serviceWorker.evaluate(readAdaptiveJobInExtension, jobId);
}

async function readAdaptiveJobFromPage(page: Page, jobId: string): Promise<AdaptiveJobState> {
  return page.evaluate(readAdaptiveJobInExtension, jobId);
}

async function waitForAdaptiveReady(
  serviceWorker: Worker,
  jobId: string,
  timeout = 120_000,
): Promise<AdaptiveJobState> {
  await expect
    .poll(
      async () => {
        const state = await readAdaptiveJob(serviceWorker, jobId);
        return state.state;
      },
      { timeout },
    )
    .toBe("ready");
  return readAdaptiveJob(serviceWorker, jobId);
}

async function waitForAdaptiveReadyFromPage(
  page: Page,
  jobId: string,
  timeout = 120_000,
): Promise<AdaptiveJobState> {
  await expect
    .poll(
      async () => {
        const state = await readAdaptiveJobFromPage(page, jobId);
        return state.state;
      },
      { timeout },
    )
    .toBe("ready");
  return readAdaptiveJobFromPage(page, jobId);
}

function expectContinuousRows(state: AdaptiveJobState): void {
  expect(state.tiles.length).toBe(state.completedTiles);
  expect(state.tiles.every((tile) => tile.status === "stored" && tile.blobSize > 0)).toBe(true);
  let bottom = 0;
  const rows = new Map<number, AdaptiveJobState["tiles"]>();
  for (const tile of state.tiles) {
    const row = rows.get(tile.row) ?? [];
    row.push(tile);
    rows.set(tile.row, row);
  }
  for (let rowIndex = 0; rowIndex < rows.size; rowIndex += 1) {
    const row = rows.get(rowIndex);
    expect(row).toBeDefined();
    const rects = row?.map((tile) => tile.outputRect).filter((rect) => rect !== null) ?? [];
    expect(rects.length).toBe(row?.length ?? 0);
    expect(Math.min(...rects.map((rect) => rect.y))).toBeCloseTo(bottom, 0);
    bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  }
  expect(bottom).toBeCloseTo(state.targetRect?.height ?? 0, 0);
}

async function restartExtensionWorker(
  worker: Worker,
  popup: Page,
  targetPage: Page,
  jobId: string,
): Promise<WorkerRestartEvidence> {
  const extensionOrigin = new URL(popup.url()).origin;
  const session = await popup.context().newCDPSession(targetPage);
  const targets = (await session.send("Target.getTargets")) as {
    targetInfos: Array<{ targetId: string; type: string; url: string }>;
  };
  const workerTarget = targets.targetInfos.find(
    (candidate) =>
      candidate.type === "service_worker" && candidate.url.startsWith(`${extensionOrigin}/`),
  );
  if (workerTarget === undefined) {
    throw new Error("The extension service-worker target could not be resolved.");
  }

  await session.send("Target.closeTarget", { targetId: workerTarget.targetId });
  await expect
    .poll(
      () =>
        worker
          .evaluate(() => true)
          .then(
            () => false,
            () => true,
          ),
      { timeout: 10_000 },
    )
    .toBe(true);

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
    throw new Error(
      `The restarted extension runtime returned an invalid response: ${JSON.stringify(
        wakeResponse,
      )}`,
    );
  }
  await targetPage.bringToFront();
  return { previousWorkerStopped: true, wakeResponseType: wakeResponse.type };
}

test("@smoke captures a real page beyond 100k CSS pixels without the legacy height cap", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  test.setTimeout(180_000);
  await targetPage.setViewportSize({ width: 900, height: 1_800 });
  await targetPage.goto("http://127.0.0.1:4174/adaptive-long-page.html");
  await targetPage.evaluate(() => window.scrollTo(0, 760));
  const before = await targetPage.evaluate(() => ({ x: scrollX, y: scrollY }));
  const target = await resolveTab(serviceWorker, targetPage);
  const popup = await openPopup();
  const jobId = await createAdaptiveJob(popup, target);

  const state = await waitForAdaptiveReady(serviceWorker, jobId, 160_000);

  expect(state.partialReason).toBeNull();
  expect(state.targetRect?.height).toBeGreaterThan(100_000);
  expect(state.frontier).toMatchObject({
    capturedBottomCss: state.targetRect?.height,
    nextYCss: state.targetRect?.height,
  });
  expect(state.frontier?.observedDocumentHeightCss).toBeGreaterThan(100_000);
  expect(state.completedTiles).toBe(state.totalTiles);
  expectContinuousRows(state);
  expect(await targetPage.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(before);
});

test("@smoke follows finite lazy growth and completes at the new stable bottom", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  test.setTimeout(120_000);
  await targetPage.setViewportSize({ width: 900, height: 1_000 });
  await targetPage.goto("http://127.0.0.1:4174/adaptive-lazy-growth.html");
  const target = await resolveTab(serviceWorker, targetPage);
  const popup = await openPopup();
  const jobId = await createAdaptiveJob(popup, target);

  const state = await waitForAdaptiveReady(serviceWorker, jobId);
  const pageState = await targetPage.evaluate(() => ({
    appended: Number(document.body.dataset.appended ?? "0"),
    height: document.documentElement.scrollHeight,
  }));

  expect(pageState.appended).toBe(3);
  expect(state.partialReason).toBeNull();
  expect(state.targetRect?.height).toBeCloseTo(pageState.height, 0);
  expect(state.frontier?.observedDocumentHeightCss).toBeCloseTo(pageState.height, 0);
  expectContinuousRows(state);
});

test("@smoke stops an infinite feed with an explicit continuous max-tiles partial", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  test.setTimeout(90_000);
  await targetPage.goto("http://127.0.0.1:4174/adaptive-infinite-growth.html");
  const before = await targetPage.evaluate(() => ({ x: scrollX, y: scrollY }));
  const target = await resolveTab(serviceWorker, targetPage);
  const popup = await openPopup();
  const jobId = await createAdaptiveJob(popup, target, { maxTiles: 6 });

  const state = await waitForAdaptiveReady(serviceWorker, jobId);

  expect(state.partialReason).toBe("max-tiles");
  expect(state.completedTiles).toBe(6);
  expect(state.totalTiles).toBe(6);
  expect(state.targetRect?.height).toBeGreaterThan(0);
  expectContinuousRows(state);
  expect(
    await targetPage.evaluate(() => Number(document.body.dataset.appended ?? "0")),
  ).toBeGreaterThan(0);
  expect(await targetPage.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(before);
});

test("@smoke resumes the persisted prefix after an extension service-worker restart", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  test.setTimeout(150_000);
  await targetPage.setViewportSize({ width: 900, height: 600 });
  await targetPage.goto("http://127.0.0.1:4174/adaptive-lazy-growth.html");
  const target = await resolveTab(serviceWorker, targetPage);
  const popup = await openPopup();
  const jobId = await createAdaptiveJob(popup, target);

  await expect
    .poll(
      async () => {
        const state = await readAdaptiveJob(serviceWorker, jobId);
        return state.state === "capturing" && state.completedTiles > 0 ? state.completedTiles : 0;
      },
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);
  const beforeRestart = await readAdaptiveJob(serviceWorker, jobId);
  const restart = await restartExtensionWorker(serviceWorker, popup, targetPage, jobId);
  expect(restart).toEqual({ previousWorkerStopped: true, wakeResponseType: "JOB_RESPONSE" });
  const final = await waitForAdaptiveReadyFromPage(popup, jobId);

  expect(final.completedTiles).toBeGreaterThanOrEqual(beforeRestart.completedTiles);
  expect(final.frontier?.capturedBottomCss).toBeGreaterThanOrEqual(
    beforeRestart.frontier?.capturedBottomCss ?? 0,
  );
  expect(final.partialReason).toBeNull();
  expectContinuousRows(final);
});
