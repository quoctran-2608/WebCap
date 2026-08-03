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

interface ElementState {
  job: {
    id: string;
    state: string;
    targetRect: { x: number; y: number; width: number; height: number } | null;
    descriptor: {
      selectionId: string;
      tagName: string;
      id?: string;
      classNames: string[];
      scrollable: boolean;
      captureKind: string;
    } | null;
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
    if (tab?.id === undefined) throw new Error("The element fixture tab could not be resolved.");
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
    selectorRoots: document.querySelectorAll("[data-webcap-element-selector]").length,
    preparationStyles: document.querySelectorAll("style[data-webcap-preparation]").length,
  }));
}

async function readElementState(serviceWorker: Worker): Promise<ElementState> {
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
      targetDescriptor?: {
        selectionId: string;
        tagName: string;
        id?: string;
        classNames: string[];
        scrollable: boolean;
        captureKind: string;
      };
      activeEngine?: string;
      completedTiles: number;
      totalTiles: number;
      updatedAt: string;
      cleanup: { completed: boolean };
      error?: { code: string; causeCode?: string };
    }>;
    const job = jobs
      .filter((candidate) => candidate.mode === "element")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const records = (
      tileValues as Array<{
        jobId: string;
        index: number;
        tile: { sourceRectCss: { x: number; y: number; width: number; height: number } };
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

    database.close();
    return {
      job:
        job === undefined
          ? null
          : {
              id: job.id,
              state: job.state,
              targetRect: job.targetRect ?? null,
              descriptor: job.targetDescriptor ?? null,
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
      tiles: records.map((record) => ({
        index: record.index,
        blobSize: record.blob?.size ?? 0,
        sourceRect: record.tile.sourceRectCss,
      })),
      firstPixel,
    };
  });
}

async function startElementSelection(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Phần tử/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp phần tử" })).toBeVisible();
  await popup.getByRole("button", { name: "Bắt đầu chọn phần tử" }).click();
}

async function waitForElementState(serviceWorker: Worker, expected: string): Promise<ElementState> {
  await expect
    .poll(
      async () => {
        const state = await readElementState(serviceWorker);
        return state.job?.state ?? "missing";
      },
      { timeout: 45_000 },
    )
    .toBe(expected);
  return readElementState(serviceWorker);
}

test("@smoke selects normal element bounds with parent-child keyboard navigation", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/element-selection.html");
  await targetPage.locator("#focus-target").focus();
  const before = await snapshotPage(targetPage);
  const popup = await openPopup();
  await startElementSelection(popup);
  await targetPage.bringToFront();

  const root = targetPage.locator("[data-webcap-element-selector]");
  await expect(root).toHaveCount(1);
  const child = targetPage.locator("#target-child");
  const childBox = await child.boundingBox();
  if (childBox === null) throw new Error("Target child is not visible.");
  await targetPage.mouse.move(childBox.x + 30, childBox.y + 30);
  await expect(root.locator("[data-label]")).toContainText(
    "span#target-child.capture-child.violet-panel",
  );
  await targetPage.mouse.click(childBox.x + 30, childBox.y + 30);
  await targetPage.keyboard.press("ArrowUp");
  await expect(root.locator("[data-label]")).toContainText(
    "article#target-card.capture-card.outer-card",
  );
  await targetPage.keyboard.press("ArrowDown");
  await expect(root.locator("[data-label]")).toContainText(
    "span#target-child.capture-child.violet-panel",
  );
  await targetPage.keyboard.press("Enter");
  await expect(root).toHaveCount(0);

  const state = await waitForElementState(serviceWorker, "ready");
  expect(state.job).toMatchObject({
    state: "ready",
    activeEngine: "cdp",
    cleanupCompleted: true,
    descriptor: {
      tagName: "span",
      id: "target-child",
      classNames: ["capture-child", "violet-panel"],
      scrollable: false,
      captureKind: "visible-bounds",
    },
  });
  expect(state.job?.targetRect).toMatchObject({
    x: childBox.x,
    y: childBox.y,
    width: childBox.width,
    height: childBox.height,
  });
  expect(state.tiles).toHaveLength(1);
  expect(state.tiles[0]?.blobSize ?? 0).toBeGreaterThan(0);
  expect(state.tiles[0]?.sourceRect).toEqual(state.job?.targetRect);
  expect(state.firstPixel?.slice(0, 3)).toEqual([124, 58, 237]);
  expect(await snapshotPage(targetPage)).toEqual(before);
});

test("@smoke selects the deepest target inside an open shadow root", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/element-selection.html");
  const popup = await openPopup();
  await startElementSelection(popup);
  await targetPage.bringToFront();

  const root = targetPage.locator("[data-webcap-element-selector]");
  const shadowButton = targetPage.locator("open-shadow-card").locator("#shadow-action");
  const box = await shadowButton.boundingBox();
  if (box === null) throw new Error("Open shadow target is not visible.");
  await targetPage.mouse.move(box.x + 25, box.y + 25);
  await targetPage.mouse.click(box.x + 25, box.y + 25);
  await expect(root.locator("[data-label]")).toContainText("button#shadow-action.shadow-button");
  await targetPage.keyboard.press("Enter");

  const state = await waitForElementState(serviceWorker, "ready");
  expect(state.job?.descriptor).toMatchObject({
    tagName: "button",
    id: "shadow-action",
    classNames: ["shadow-button"],
  });
  expect(state.job?.targetRect).toMatchObject({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  });
  expect(state.tiles).toHaveLength(1);
  await expect(root).toHaveCount(0);
});

test("@smoke fails stale target safely instead of capturing a replacement", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/element-selection.html");
  await targetPage.locator("#focus-target").focus();
  const before = await snapshotPage(targetPage);
  const tabId = await resolveTab(serviceWorker, targetPage);
  const popup = await openPopup();
  await startElementSelection(popup);
  await targetPage.bringToFront();

  const root = targetPage.locator("[data-webcap-element-selector]");
  const stale = targetPage.locator("#stale-target");
  const box = await stale.boundingBox();
  if (box === null) throw new Error("Stale target is not visible.");
  await targetPage.mouse.click(box.x + 20, box.y + 20);
  await targetPage.evaluate(() => document.querySelector("#stale-target")?.remove());
  await targetPage.keyboard.press("Enter");
  await expect(root).toHaveCount(0);

  const state = await waitForElementState(serviceWorker, "failed");
  expect(state.tiles).toEqual([]);
  expect(state.job).toMatchObject({
    state: "failed",
    cleanupCompleted: true,
    errorCode: "E_TARGET_STALE",
    errorCause: "ElementTargetDisconnected",
  });
  expect(await snapshotPage(targetPage)).toEqual(before);

  await targetPage.bringToFront();
  await serviceWorker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(
    popup.getByRole("heading", { name: "Không thể hoàn tất chụp phần tử" }),
  ).toBeVisible();
  await expect(popup.getByRole("button", { name: "Chọn lại phần tử" })).toBeVisible();
});

test("@smoke cancels element selection with accessible keyboard controls", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/element-selection.html");
  await targetPage.locator("#focus-target").focus();
  const before = await snapshotPage(targetPage);
  const popup = await openPopup();
  await startElementSelection(popup);
  await targetPage.bringToFront();

  const root = targetPage.locator("[data-webcap-element-selector]");
  await expect(root.getByRole("dialog", { name: "Chọn phần tử cần chụp" })).toBeVisible();
  await expect(root.getByRole("button", { name: "Hủy" })).toBeFocused();
  await targetPage.keyboard.press("Escape");
  await expect(root).toHaveCount(0);

  const state = await waitForElementState(serviceWorker, "cancelled");
  expect(state.tiles).toEqual([]);
  expect(state.job).toMatchObject({
    state: "cancelled",
    cleanupCompleted: true,
    errorCode: "E_CANCELLED",
  });
  expect(await snapshotPage(targetPage)).toEqual(before);
});
