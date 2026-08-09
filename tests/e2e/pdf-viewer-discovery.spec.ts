import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface DiscoveryState {
  id?: string;
  state?: string;
  completedTiles?: number;
  error?: unknown;
  documentPageMap?: {
    strategy: string;
    confidence: number;
    complete: boolean;
    sourcePageCount: number;
    pages: Array<{
      index: number;
      sourceRectCss: { x: number; y: number; width: number; height: number };
    }>;
  };
}

async function startScrollAreaSelection(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Vùng cuộn/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp toàn bộ vùng cuộn" })).toBeVisible();
  await popup.getByRole("button", { name: "Bắt đầu chọn vùng cuộn" }).click();
}

async function selectScrollableViewer(targetPage: Page): Promise<void> {
  const target = targetPage.locator("#pdf-scroll");
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("The virtualized PDF viewer fixture is not visible.");
  const selector = targetPage.locator("[data-webcap-element-selector]");
  const gutterX = box.x + 8;
  const gutterY = box.y + box.height / 2;
  await targetPage.mouse.move(gutterX, gutterY);
  await targetPage.mouse.click(gutterX, gutterY);
  await expect(selector.locator("[data-label]")).toContainText("nội dung");
  await targetPage.keyboard.press("Enter");
  await expect(selector).toHaveCount(0);
}

async function readDiscoveryState(serviceWorker: Worker): Promise<DiscoveryState> {
  return serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open WebCap database."));
    });
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction("jobs", "readonly");
      const request = transaction.objectStore("jobs").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to read WebCap jobs."));
    });
    database.close();
    const jobs = values as Array<{
      id: string;
      mode: string;
      state: string;
      completedTiles: number;
      updatedAt: string;
      error?: unknown;
      documentPageMap?: DiscoveryState["documentPageMap"];
    }>;
    const job = jobs
      .filter((candidate) => candidate.mode === "scroll-area")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return job === undefined
      ? {}
      : {
          id: job.id,
          state: job.state,
          completedTiles: job.completedTiles,
          ...(job.error === undefined ? {} : { error: job.error }),
          ...(job.documentPageMap === undefined ? {} : { documentPageMap: job.documentPageMap }),
        };
  });
}

test("@smoke discovers all 500 virtualized PDF pages without simultaneous DOM nodes", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/pdf-virtualized-viewer.html");
  const popup = await openPopup();
  await startScrollAreaSelection(popup);
  await targetPage.bringToFront();
  await selectScrollableViewer(targetPage);

  await expect
    .poll(
      async () => {
        const state = await readDiscoveryState(serviceWorker);
        if (state.state === "failed") {
          throw new Error(`S30 discovery job failed: ${JSON.stringify(state.error)}`);
        }
        return state.documentPageMap?.sourcePageCount ?? 0;
      },
      {
        timeout: 60_000,
      },
    )
    .toBe(500);

  const state = await readDiscoveryState(serviceWorker);
  expect(state.documentPageMap).toMatchObject({
    strategy: "dom",
    complete: true,
    sourcePageCount: 500,
    pages: expect.arrayContaining([
      expect.objectContaining({
        index: 4,
        sourceRectCss: expect.objectContaining({ width: 850, height: 120 }),
      }),
      expect.objectContaining({
        index: 6,
        sourceRectCss: expect.objectContaining({ width: 590, height: 130 }),
      }),
    ]),
  });
  expect(state.documentPageMap?.pages).toHaveLength(500);
  expect(state.documentPageMap?.confidence ?? 0).toBeGreaterThanOrEqual(0.9);

  const fixtureStats = await targetPage.evaluate(() => {
    return (
      window as typeof window & {
        __webcapVirtualPdfFixture?: {
          pageCount: number;
          livePages: number;
          maxLivePages: number;
          renderCount: number;
        };
      }
    ).__webcapVirtualPdfFixture;
  });
  expect(fixtureStats).toBeDefined();
  expect(fixtureStats?.pageCount).toBe(500);
  expect(fixtureStats?.maxLivePages ?? 500).toBeLessThanOrEqual(12);
  expect(fixtureStats?.renderCount ?? 0).toBeGreaterThan(20);
});
