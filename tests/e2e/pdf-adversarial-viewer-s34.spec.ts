import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface S34DiscoveryState {
  state?: string;
  error?: unknown;
  documentPageMap?: {
    sourcePageCount: number;
    pages: Array<{
      index: number;
      sourceRectCss: { x: number; y: number; width: number; height: number };
    }>;
  };
}

async function startScrollAreaSelection(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Vùng cuộn/ }).click();
  await popup.getByRole("button", { name: "Bắt đầu chọn vùng cuộn" }).click();
}

async function selectViewer(page: Page): Promise<void> {
  const target = page.locator("#pdf-scroll");
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("The S34 adversarial viewer is not visible.");
  const selector = page.locator("[data-webcap-element-selector]");
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  await expect(selector.locator("[data-label]")).toContainText("nội dung");
  await page.keyboard.press("Enter");
  await expect(selector).toHaveCount(0);
}

async function readState(worker: Worker): Promise<S34DiscoveryState> {
  return worker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open WebCap database."));
    });
    const jobs = await new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction("jobs", "readonly").objectStore("jobs").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to read WebCap jobs."));
    });
    database.close();
    const latest = (
      jobs as Array<{
        mode: string;
        state: string;
        updatedAt: string;
        error?: unknown;
        documentPageMap?: S34DiscoveryState["documentPageMap"];
      }>
    )
      .filter((job) => job.mode === "scroll-area")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return latest === undefined
      ? {}
      : {
          state: latest.state,
          ...(latest.error === undefined ? {} : { error: latest.error }),
          ...(latest.documentPageMap === undefined
            ? {}
            : { documentPageMap: latest.documentPageMap }),
        };
  });
}

test("@smoke keeps blank and duplicate-looking PDF pages while waiting out a lazy placeholder", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  test.setTimeout(90_000);
  await targetPage.goto("http://127.0.0.1:4174/pdf-adversarial-viewer.html");
  const popup = await openPopup();
  await startScrollAreaSelection(popup);
  await targetPage.bringToFront();
  await selectViewer(targetPage);

  await expect
    .poll(
      async () => {
        const state = await readState(serviceWorker);
        if (state.state === "failed") {
          throw new Error(`S34 adversarial viewer failed: ${JSON.stringify(state.error)}`);
        }
        return state.documentPageMap?.sourcePageCount ?? 0;
      },
      { timeout: 45_000 },
    )
    .toBe(4);

  const state = await readState(serviceWorker);
  expect(state.documentPageMap?.pages.map((page) => page.index)).toEqual([0, 1, 2, 3]);
  expect(state.documentPageMap?.pages[0]?.sourceRectCss).toMatchObject({ width: 600, height: 300 });
  expect(state.documentPageMap?.pages[2]?.sourceRectCss).toMatchObject({ width: 600, height: 300 });
  expect(state.documentPageMap?.pages[3]?.sourceRectCss).toMatchObject({ width: 600, height: 300 });
  expect(state.documentPageMap?.pages[2]?.sourceRectCss.y).not.toBe(
    state.documentPageMap?.pages[3]?.sourceRectCss.y,
  );

  const fixture = await targetPage.evaluate(() => {
    return (
      window as typeof window & {
        __webcapAdversarialPdfFixture?: { lazyReleased: boolean; releaseCount: number };
      }
    ).__webcapAdversarialPdfFixture;
  });
  expect(fixture).toEqual({ lazyReleased: true, releaseCount: 1 });

  const cleanupPopup = await openPopup();
  const cancel = cleanupPopup.getByRole("button", { name: "Hủy chụp", exact: true });
  if (await cancel.isVisible().catch(() => false)) await cancel.click();
});
