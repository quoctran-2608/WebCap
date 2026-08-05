import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface PageSnapshot {
  scrollX: number;
  scrollY: number;
  activeId: string | null;
  htmlStyle: string | null;
  bodyStyle: string | null;
  preparationStyles: number;
}

interface StoredFullPageState {
  job: {
    id: string;
    state: string;
    activeEngine?: string;
    completedTiles: number;
    totalTiles: number;
    errorCode?: string;
    errorCause?: string;
    fallbackAllowed?: boolean;
    cleanupCompleted: boolean;
    tileStatuses: string[];
  } | null;
  tiles: Array<{
    index: number;
    status: string;
    attempts: number;
    byteLength: number;
    blobSize: number;
    outputRect: { x: number; y: number; width: number; height: number } | null;
  }>;
}

async function resolveFixtureTab(serviceWorker: Worker, page: Page): Promise<number> {
  return serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined) {
      throw new Error("The full-page fixture tab could not be resolved.");
    }
    return tab.id;
  }, page.url());
}

async function activateFixtureTab(serviceWorker: Worker, page: Page): Promise<void> {
  await page.bringToFront();
  await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined || tab.windowId === undefined) {
      throw new Error("The full-page fixture tab could not be activated.");
    }
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }, page.url());
}

async function snapshotPage(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => ({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    activeId: document.activeElement?.id ?? null,
    htmlStyle: document.documentElement.getAttribute("style"),
    bodyStyle: document.body.getAttribute("style"),
    preparationStyles: document.querySelectorAll("style[data-webcap-preparation]").length,
  }));
}

async function readFullPageState(serviceWorker: Worker): Promise<StoredFullPageState> {
  return serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open test database."));
    });
    const transaction = database.transaction(["jobs", "tiles"], "readonly");
    const requestValue = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB test read failed."));
      });
    const [jobValues, tileValues] = await Promise.all([
      requestValue<unknown[]>(transaction.objectStore("jobs").getAll()),
      requestValue<unknown[]>(transaction.objectStore("tiles").getAll()),
    ]);
    const jobs = jobValues as Array<{
      id: string;
      mode: string;
      state: string;
      activeEngine?: string;
      completedTiles: number;
      totalTiles: number;
      updatedAt: string;
      cleanup: { completed: boolean };
      error?: { code: string; causeCode?: string; fallbackAllowed: boolean };
      tilePlan: Array<{ status: string }>;
    }>;
    const job = jobs
      .filter((candidate) => candidate.mode === "full-page")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const tiles = (
      tileValues as Array<{
        jobId: string;
        index: number;
        tile: {
          status: string;
          attempts: number;
          byteLength?: number;
          outputRectCss?: { x: number; y: number; width: number; height: number };
        };
        blob?: Blob;
      }>
    )
      .filter((record) => job !== undefined && record.jobId === job.id)
      .sort((left, right) => left.index - right.index)
      .map((record) => ({
        index: record.index,
        status: record.tile.status,
        attempts: record.tile.attempts,
        byteLength: record.tile.byteLength ?? 0,
        blobSize: record.blob?.size ?? 0,
        outputRect: record.tile.outputRectCss ?? null,
      }));
    database.close();
    return {
      job:
        job === undefined
          ? null
          : {
              id: job.id,
              state: job.state,
              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),
              completedTiles: job.completedTiles,
              totalTiles: job.totalTiles,
              ...(job.error === undefined
                ? {}
                : {
                    errorCode: job.error.code,
                    ...(job.error.causeCode === undefined
                      ? {}
                      : { errorCause: job.error.causeCode }),
                    fallbackAllowed: job.error.fallbackAllowed,
                  }),
              cleanupCompleted: job.cleanup.completed,
              tileStatuses: job.tilePlan.map((tile) => tile.status),
            },
      tiles,
    };
  });
}

async function selectFullPage(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Toàn bộ trang/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp toàn bộ trang" })).toBeVisible();
}

test("@smoke captures a multi-tile full page, persists tiles, restores, and detaches", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/full-page-long.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(() => targetPage.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  const before = await snapshotPage(targetPage);
  const tabId = await resolveFixtureTab(serviceWorker, targetPage);
  const popup = await openPopup();

  await selectFullPage(popup);
  await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();
  await expect(popup.getByText("Tile set toàn trang đã sẵn sàng.")).toBeVisible({
    timeout: 45_000,
  });

  const state = await readFullPageState(serviceWorker);
  expect(state.job).toMatchObject({
    state: "ready",
    activeEngine: "scroll",
    cleanupCompleted: true,
  });
  expect(state.job?.completedTiles).toBeGreaterThan(0);
  expect(state.job?.completedTiles).toBe(state.job?.totalTiles);
  expect(state.job?.tileStatuses.every((status) => status === "stored")).toBe(true);
  expect(state.tiles.map((tile) => tile.index)).toEqual(
    Array.from({ length: state.tiles.length }, (_, index) => index),
  );
  expect(state.tiles.every((tile) => tile.status === "stored" && tile.blobSize > 0)).toBe(true);
  expect(state.tiles.every((tile) => tile.byteLength === tile.blobSize)).toBe(true);
  expect(state.tiles.every((tile) => tile.outputRect !== null)).toBe(true);
  expect(await snapshotPage(targetPage)).toEqual(before);

  await expect
    .poll(
      () =>
        serviceWorker.evaluate(async (id) => {
          try {
            await chrome.debugger.attach({ tabId: id }, "1.3");
            await chrome.debugger.detach({ tabId: id });
            return true;
          } catch {
            return false;
          }
        }, tabId),
      { timeout: 5_000 },
    )
    .toBe(true);
});

test("@smoke cancels full-page preparation and restores page state", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/lazy-images.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 380));
  await expect.poll(() => targetPage.evaluate(() => window.scrollY)).toBeGreaterThan(250);
  const before = await snapshotPage(targetPage);
  const popup = await openPopup();

  await selectFullPage(popup);
  await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();
  await popup.getByRole("button", { name: "Hủy chụp" }).click();
  await expect(
    popup.getByTestId("full-page-progress").getByText("Đã hủy chụp toàn trang."),
  ).toBeVisible({ timeout: 30_000 });

  const state = await readFullPageState(serviceWorker);
  expect(state.job).toMatchObject({
    state: "cancelled",
    errorCode: "E_CANCELLED",
    cleanupCompleted: true,
  });
  expect(await snapshotPage(targetPage)).toEqual(before);
});

test("@smoke keeps adaptive full-page capture independent of debugger occupancy", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/visible-capture.html");
  await targetPage.locator("body").click({ position: { x: 20, y: 20 } });
  const before = await snapshotPage(targetPage);
  const tabId = await resolveFixtureTab(serviceWorker, targetPage);
  await serviceWorker.evaluate(async (id) => chrome.debugger.attach({ tabId: id }, "1.3"), tabId);

  try {
    const popup = await openPopup();
    await selectFullPage(popup);
    await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();
    await activateFixtureTab(serviceWorker, targetPage);
    await expect
      .poll(
        async () => {
          const state = await readFullPageState(serviceWorker);
          if (state.job?.state === "failed" || state.job?.state === "cancelled") {
            return `${state.job.state}:${state.job.errorCode ?? "unknown"}:${state.job.errorCause ?? "unknown"}`;
          }
          return state.job?.state ?? "missing";
        },
        { timeout: 45_000 },
      )
      .toBe("ready");

    const state = await readFullPageState(serviceWorker);
    expect(state.job).toMatchObject({
      state: "ready",
      activeEngine: "scroll",
      cleanupCompleted: true,
    });
    expect(state.job?.completedTiles).toBe(state.job?.totalTiles);
    expect(state.tiles.length).toBeGreaterThan(0);
    expect(state.tiles.every((tile) => tile.outputRect !== null && tile.blobSize > 0)).toBe(true);
    expect(await snapshotPage(targetPage)).toEqual(before);

    await popup.bringToFront();
    await expect(popup.getByText("Tile set toàn trang đã sẵn sàng.")).toBeVisible({
      timeout: 5_000,
    });
  } finally {
    await serviceWorker
      .evaluate(async (id) => chrome.debugger.detach({ tabId: id }), tabId)
      .catch(() => undefined);
  }
});
