import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface PageSnapshot {
  scrollX: number;
  scrollY: number;
  activeId: string | null;
  headerStyle: string | null;
  footerStyle: string | null;
  scrollMarkers: number;
  preparationStyles: number;
}

interface FallbackState {
  job: {
    state: string;
    activeEngine?: string;
    completedTiles: number;
    totalTiles: number;
    cleanupCompleted: boolean;
  } | null;
  tiles: Array<{
    index: number;
    row: number;
    column: number;
    fixedElementsHidden: number;
    overlapTopCss: number;
    overlapLeftCss: number;
    outputX: number;
    outputY: number;
    outputWidth: number;
    outputHeight: number;
    blobSize: number;
  }>;
}

async function resolveFixtureTab(serviceWorker: Worker, page: Page): Promise<number> {
  return serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined) {
      throw new Error("The fallback fixture tab could not be resolved.");
    }
    return tab.id;
  }, page.url());
}

async function occupyDebugger(serviceWorker: Worker, tabId: number): Promise<void> {
  await serviceWorker.evaluate(async (id) => chrome.debugger.attach({ tabId: id }, "1.3"), tabId);
}

async function releaseDebugger(serviceWorker: Worker, tabId: number): Promise<void> {
  await serviceWorker
    .evaluate(async (id) => chrome.debugger.detach({ tabId: id }), tabId)
    .catch(() => undefined);
}

async function snapshotPage(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => ({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    activeId: document.activeElement?.id ?? null,
    headerStyle: document.querySelector("header")?.getAttribute("style") ?? null,
    footerStyle: document.querySelector("footer")?.getAttribute("style") ?? null,
    scrollMarkers: document.querySelectorAll("[data-webcap-scroll-preparation]").length,
    preparationStyles: document.querySelectorAll("style[data-webcap-preparation]").length,
  }));
}

async function readFallbackState(serviceWorker: Worker): Promise<FallbackState> {
  return serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open fallback DB."));
    });
    const transaction = database.transaction(["jobs", "tiles"], "readonly");
    const requestValue = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Fallback DB read failed."));
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
    }>;
    const job = jobs
      .filter((candidate) => candidate.mode === "full-page")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const tiles = (
      tileValues as Array<{
        jobId: string;
        index: number;
        tile: {
          row: number;
          column: number;
          fixedElementsHidden?: number;
          overlapTopCss: number;
          overlapLeftCss: number;
          outputRectCss?: { x: number; y: number; width: number; height: number };
        };
        blob?: Blob;
      }>
    )
      .filter((record) => job !== undefined && record.jobId === job.id)
      .sort((left, right) => left.index - right.index)
      .map((record) => ({
        index: record.index,
        row: record.tile.row,
        column: record.tile.column,
        fixedElementsHidden: record.tile.fixedElementsHidden ?? 0,
        overlapTopCss: record.tile.overlapTopCss,
        overlapLeftCss: record.tile.overlapLeftCss,
        outputX: record.tile.outputRectCss?.x ?? -1,
        outputY: record.tile.outputRectCss?.y ?? -1,
        outputWidth: record.tile.outputRectCss?.width ?? 0,
        outputHeight: record.tile.outputRectCss?.height ?? 0,
        blobSize: record.blob?.size ?? 0,
      }));
    database.close();
    return {
      job:
        job === undefined
          ? null
          : {
              state: job.state,
              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),
              completedTiles: job.completedTiles,
              totalTiles: job.totalTiles,
              cleanupCompleted: job.cleanup.completed,
            },
      tiles,
    };
  });
}

async function startFullPageFallback(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Toàn bộ trang/ }).click();
  await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();
  await expect(popup.getByText("Tile set toàn trang đã sẵn sàng.")).toBeVisible({
    timeout: 60_000,
  });
}

function expectContinuousRows(tiles: FallbackState["tiles"]): void {
  const firstColumn = tiles.filter((tile) => tile.column === 0);
  expect(firstColumn.length).toBeGreaterThan(1);
  expect(firstColumn[0]?.outputY).toBe(0);
  for (let index = 1; index < firstColumn.length; index += 1) {
    const previous = firstColumn[index - 1];
    const current = firstColumn[index];
    expect(current?.outputY).toBeCloseTo(
      (previous?.outputY ?? 0) + (previous?.outputHeight ?? 0),
      5,
    );
  }
}

test("@smoke uses smart fixed policy and restores the page after scroll fallback", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/fixed-header-footer.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 360));
  await expect.poll(() => targetPage.evaluate(() => window.scrollY)).toBeGreaterThan(250);
  const before = await snapshotPage(targetPage);
  const tabId = await resolveFixtureTab(serviceWorker, targetPage);
  await occupyDebugger(serviceWorker, tabId);

  try {
    const popup = await openPopup();
    await startFullPageFallback(popup);

    const state = await readFallbackState(serviceWorker);
    expect(state.job).toMatchObject({
      state: "ready",
      activeEngine: "scroll",
      cleanupCompleted: true,
    });
    expect(state.job?.completedTiles).toBe(state.job?.totalTiles);
    expect(state.tiles.length).toBe(state.job?.totalTiles);
    expect(state.tiles.every((tile) => tile.blobSize > 0)).toBe(true);
    expect(state.tiles[0]?.fixedElementsHidden).toBe(1);
    expect(state.tiles.at(-1)?.fixedElementsHidden).toBe(1);
    expect(state.tiles.slice(1, -1).every((tile) => tile.fixedElementsHidden >= 1)).toBe(true);
    expectContinuousRows(state.tiles);
    expect(await snapshotPage(targetPage)).toEqual(before);
  } finally {
    await releaseDebugger(serviceWorker, tabId);
  }
});

test("@smoke covers a wide table with a two-dimensional fallback grid", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/wide-table.html");
  await targetPage.locator("#focus-target").focus();
  const before = await snapshotPage(targetPage);
  const tabId = await resolveFixtureTab(serviceWorker, targetPage);
  await occupyDebugger(serviceWorker, tabId);

  try {
    const popup = await openPopup();
    await startFullPageFallback(popup);

    const state = await readFallbackState(serviceWorker);
    expect(state.job).toMatchObject({
      state: "ready",
      activeEngine: "scroll",
      cleanupCompleted: true,
    });
    expect(new Set(state.tiles.map((tile) => tile.column)).size).toBeGreaterThan(1);
    expect(new Set(state.tiles.map((tile) => tile.row)).size).toBeGreaterThan(1);
    expect(state.tiles.every((tile) => tile.outputWidth > 0 && tile.outputHeight > 0)).toBe(true);
    expect(state.tiles.some((tile) => tile.overlapLeftCss > 0)).toBe(true);
    expect(state.tiles.some((tile) => tile.overlapTopCss > 0)).toBe(true);
    expect(await snapshotPage(targetPage)).toEqual(before);
  } finally {
    await releaseDebugger(serviceWorker, tabId);
  }
});
