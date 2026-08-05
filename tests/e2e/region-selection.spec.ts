import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface PageSnapshot {
  scrollX: number;
  scrollY: number;
  activeId: string | null;
  htmlStyle: string | null;
  bodyStyle: string | null;
  selectorRoots: number;
  preparationStyles: number;
}

interface RegionState {
  job: {
    id: string;
    state: string;
    targetRect: { x: number; y: number; width: number; height: number } | null;
    activeEngine?: string;
    completedTiles: number;
    totalTiles: number;
    cleanupCompleted: boolean;
    errorCode?: string;
    errorCause?: string;
  } | null;
  tiles: Array<{
    index: number;
    blobSize: number;
    sourceRect: { x: number; y: number; width: number; height: number };
  }>;
  firstPixel: [number, number, number, number] | null;
}

async function resolveTab(serviceWorker: Worker, page: Page): Promise<number> {
  return serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined) {
      throw new Error("The region fixture tab could not be resolved.");
    }
    return tab.id;
  }, page.url());
}

async function snapshotPage(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => ({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    activeId: document.activeElement?.id ?? null,
    htmlStyle: document.documentElement.getAttribute("style"),
    bodyStyle: document.body.getAttribute("style"),
    selectorRoots: document.querySelectorAll("[data-webcap-region-selector]").length,
    preparationStyles: document.querySelectorAll("style[data-webcap-preparation]").length,
  }));
}

async function readRegionState(serviceWorker: Worker): Promise<RegionState> {
  return serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open WebCap database."));
    });
    const read = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
      });
    const transaction = database.transaction(["jobs", "tiles"], "readonly");
    const [jobValues, tileValues] = await Promise.all([
      read<unknown[]>(transaction.objectStore("jobs").getAll()),
      read<unknown[]>(transaction.objectStore("tiles").getAll()),
    ]);
    const jobs = jobValues as Array<{
      id: string;
      mode: string;
      state: string;
      targetRect?: { x: number; y: number; width: number; height: number };
      activeEngine?: string;
      completedTiles: number;
      totalTiles: number;
      updatedAt: string;
      cleanup: { completed: boolean };
      error?: { code: string; causeCode?: string };
    }>;
    const job = jobs
      .filter((candidate) => candidate.mode === "region")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const records = (
      tileValues as Array<{
        jobId: string;
        index: number;
        tile: {
          sourceRectCss: { x: number; y: number; width: number; height: number };
        };
        blob?: Blob;
      }>
    )
      .filter((record) => job !== undefined && record.jobId === job.id)
      .sort((left, right) => left.index - right.index);

    let firstPixel: [number, number, number, number] | null = null;
    const firstBlob = records[0]?.blob;
    if (firstBlob !== undefined) {
      const bitmap = await createImageBitmap(firstBlob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context !== null) {
        context.drawImage(bitmap, 0, 0);
        const pixel = context.getImageData(
          Math.min(10, Math.max(0, bitmap.width - 1)),
          Math.min(10, Math.max(0, bitmap.height - 1)),
          1,
          1,
        ).data;
        firstPixel = [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0, pixel[3] ?? 0];
      }
      bitmap.close();
    }

    const tiles = records.map((record) => ({
      index: record.index,
      blobSize: record.blob?.size ?? 0,
      sourceRect: record.tile.sourceRectCss,
    }));
    database.close();
    return {
      job:
        job === undefined
          ? null
          : {
              id: job.id,
              state: job.state,
              targetRect: job.targetRect ?? null,
              ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),
              completedTiles: job.completedTiles,
              totalTiles: job.totalTiles,
              cleanupCompleted: job.cleanup.completed,
              ...(job.error === undefined
                ? {}
                : {
                    errorCode: job.error.code,
                    ...(job.error.causeCode === undefined
                      ? {}
                      : { errorCause: job.error.causeCode }),
                  }),
            },
      tiles,
      firstPixel,
    };
  });
}

async function startRegionSelection(popup: Page, targetPage: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Vùng tự chọn/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp vùng tự chọn" })).toBeVisible();
  await Promise.all([
    popup.waitForEvent("close"),
    popup.getByRole("button", { name: "Bắt đầu chọn vùng" }).click(),
  ]);
  await targetPage.bringToFront();
  await expect(targetPage.locator("[data-webcap-region-selector]")).toHaveCount(1, {
    timeout: 500,
  });
}

async function waitForRegionReady(serviceWorker: Worker): Promise<RegionState> {
  await expect
    .poll(
      async () => {
        const state = await readRegionState(serviceWorker);
        if (state.job?.state === "failed" || state.job?.state === "cancelled") {
          return `${state.job.state}:${state.job.errorCode ?? "unknown"}:${state.job.errorCause ?? "unknown"}`;
        }
        return state.job?.state ?? "missing";
      },
      { timeout: 45_000 },
    )
    .toBe("ready");
  return readRegionState(serviceWorker);
}

test("@smoke selects a region longer than the viewport and captures it without the overlay", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/region-selection.html");
  await targetPage.locator("#focus-target").focus();
  const tabId = await resolveTab(serviceWorker, targetPage);
  const before = await snapshotPage(targetPage);
  const popup = await openPopup();

  await startRegionSelection(popup, targetPage);
  await targetPage.bringToFront();
  const root = targetPage.locator("[data-webcap-region-selector]");
  await expect(root).toHaveCount(1);

  await targetPage.mouse.move(160, 180);
  await targetPage.mouse.down();
  await targetPage.mouse.move(700, 575, { steps: 12 });
  await expect.poll(() => targetPage.evaluate(() => window.scrollY)).toBeGreaterThan(450);
  await targetPage.waitForTimeout(350);
  await targetPage.mouse.up();
  await root.getByRole("button", { name: "Chụp vùng" }).click();
  await expect(root).toHaveCount(0);

  const state = await waitForRegionReady(serviceWorker);
  expect(state.job).toMatchObject({
    state: "ready",
    activeEngine: "cdp",
    cleanupCompleted: true,
  });
  expect(state.job?.targetRect?.x).toBeCloseTo(160, 0);
  expect(state.job?.targetRect?.y).toBeCloseTo(180, 0);
  expect(state.job?.targetRect?.width).toBeCloseTo(540, 0);
  expect(state.job?.targetRect?.height ?? 0).toBeGreaterThan(800);
  expect(state.tiles.length).toBeGreaterThan(0);
  expect(state.tiles.every((tile) => tile.blobSize > 0)).toBe(true);
  expect(state.tiles[0]?.sourceRect).toMatchObject(state.job?.targetRect ?? {});
  expect(state.firstPixel?.[0]).toBeCloseTo(37, -1);
  expect(state.firstPixel?.[1]).toBeCloseTo(99, -1);
  expect(state.firstPixel?.[2]).toBeCloseTo(235, -1);
  expect(await snapshotPage(targetPage)).toEqual(before);

  await targetPage.bringToFront();
  await serviceWorker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
  const restoredPopup = await openPopup();
  await expect(restoredPopup.getByText("Tile set vùng chọn đã sẵn sàng.")).toBeVisible();
});

test("@smoke cancels region selection with Escape and restores the page", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/region-selection.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 240));
  await expect.poll(() => targetPage.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  const before = await snapshotPage(targetPage);
  const popup = await openPopup();

  await startRegionSelection(popup, targetPage);
  await targetPage.bringToFront();
  const root = targetPage.locator("[data-webcap-region-selector]");
  await expect(root).toHaveCount(1);
  await targetPage.keyboard.press("Escape");
  await expect(root).toHaveCount(0);

  await expect
    .poll(async () => (await readRegionState(serviceWorker)).job?.state ?? "missing")
    .toBe("cancelled");
  const state = await readRegionState(serviceWorker);
  expect(state.tiles).toEqual([]);
  expect(state.job).toMatchObject({
    state: "cancelled",
    errorCode: "E_CANCELLED",
    cleanupCompleted: true,
  });
  expect(await snapshotPage(targetPage)).toEqual(before);
});

test("@dpr keeps the confirmed document rectangle stable at DPR 2 and 125% zoom", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/region-selection.html");
  const tabId = await resolveTab(serviceWorker, targetPage);
  await serviceWorker.evaluate(async (id) => chrome.tabs.setZoom(id, 1.25), tabId);

  try {
    const popup = await openPopup();
    await startRegionSelection(popup, targetPage);
    await targetPage.bringToFront();
    const root = targetPage.locator("[data-webcap-region-selector]");
    await expect(root).toHaveCount(1);

    await targetPage.mouse.move(180, 170);
    await targetPage.mouse.down();
    await targetPage.mouse.move(200, 190, { steps: 2 });
    const selection = root.locator("[data-selection]");
    await expect(selection).toBeVisible();
    await targetPage.mouse.move(500, 410, { steps: 8 });
    await targetPage.mouse.up();
    const confirm = root.getByRole("button", { name: "Chụp vùng" });
    await expect(confirm).toBeEnabled();
    await confirm.click();

    const state = await waitForRegionReady(serviceWorker);
    expect(state.job?.targetRect?.x).toBeCloseTo(180, 0);
    expect(state.job?.targetRect?.y).toBeCloseTo(170, 0);
    expect(state.job?.targetRect?.width).toBeCloseTo(320, 0);
    expect(state.job?.targetRect?.height).toBeCloseTo(240, 0);
    expect(state.tiles).toHaveLength(1);
    expect(state.tiles[0]?.sourceRect).toMatchObject(state.job?.targetRect ?? {});
    await expect(targetPage.locator("[data-webcap-region-selector]")).toHaveCount(0);
  } finally {
    await serviceWorker
      .evaluate(async (id) => chrome.tabs.setZoom(id, 1), tabId)
      .catch(() => undefined);
  }
});
