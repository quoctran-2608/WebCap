import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface ScrollAreaState {
  job: {
    id: string;
    state: string;
    targetRect: { x: number; y: number; width: number; height: number } | null;
    descriptor: { selectionId: string; captureKind: string; scrollable: boolean } | null;
    activeEngine?: string;
    activeOutputFormat?: string;
    outputArtifactId?: string;
    output?: {
      artifactId: string;
      format: string;
      mimeType: string;
      byteLength: number;
      pageCount?: number;
    };
    completedTiles: number;
    totalTiles: number;
    cleanupCompleted: boolean;
    errorCode?: string;
    errorCause?: string;
  } | null;
  tiles: Array<{
    index: number;
    row: number;
    column: number;
    outputRect: { x: number; y: number; width: number; height: number } | null;
    captureCrop: { x: number; y: number; width: number; height: number } | null;
    captureViewport: { x: number; y: number; width: number; height: number } | null;
    hiddenSticky: number;
    blobSize: number;
  }>;
}

async function readScrollAreaState(serviceWorker: Worker): Promise<ScrollAreaState> {
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
      targetDescriptor?: { selectionId: string; captureKind: string; scrollable: boolean };
      activeEngine?: string;
      activeOutputFormat?: string;
      outputArtifactId?: string;
      output?: {
        artifactId: string;
        format: string;
        mimeType: string;
        byteLength: number;
        pageCount?: number;
      };
      completedTiles: number;
      totalTiles: number;
      cleanup: { completed: boolean };
      updatedAt: string;
      error?: { code: string; causeCode?: string };
    }>;
    const job = jobs
      .filter((candidate) => candidate.mode === "scroll-area")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const records = (
      tileValues as Array<{
        jobId: string;
        index: number;
        tile: {
          row: number;
          column: number;
          outputRectCss?: { x: number; y: number; width: number; height: number };
          captureCropCss?: { x: number; y: number; width: number; height: number };
          captureViewportCss?: { x: number; y: number; width: number; height: number };
          fixedElementsHidden?: number;
        };
        blob?: Blob;
      }>
    )
      .filter((record) => job !== undefined && record.jobId === job.id)
      .sort((left, right) => left.index - right.index);
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
              ...(job.activeOutputFormat === undefined
                ? {}
                : { activeOutputFormat: job.activeOutputFormat }),
              ...(job.outputArtifactId === undefined
                ? {}
                : { outputArtifactId: job.outputArtifactId }),
              ...(job.output === undefined ? {} : { output: job.output }),
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
        row: record.tile.row,
        column: record.tile.column,
        outputRect: record.tile.outputRectCss ?? null,
        captureCrop: record.tile.captureCropCss ?? null,
        captureViewport: record.tile.captureViewportCss ?? null,
        hiddenSticky: record.tile.fixedElementsHidden ?? 0,
        blobSize: record.blob?.size ?? 0,
      })),
    };
  });
}

async function resolveTab(serviceWorker: Worker, page: Page): Promise<number> {
  return serviceWorker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
    if (tab?.id === undefined) {
      throw new Error("The scroll-area fixture tab could not be resolved.");
    }
    return tab.id;
  }, page.url());
}

async function startScrollAreaSelection(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Vùng cuộn/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp toàn bộ vùng cuộn" })).toBeVisible();
  await popup.getByRole("button", { name: "Bắt đầu chọn vùng cuộn" }).click();
}

async function selectContainer(
  targetPage: Page,
  locator: ReturnType<Page["locator"]>,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Scrollable target is not visible.");
  const root = targetPage.locator("[data-webcap-element-selector]");
  await targetPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await targetPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(root.locator("[data-label]")).toContainText("nội dung");
  await targetPage.keyboard.press("Enter");
  await expect(root).toHaveCount(0);
}

async function waitForState(serviceWorker: Worker, expected: string): Promise<ScrollAreaState> {
  await expect
    .poll(async () => (await readScrollAreaState(serviceWorker)).job?.state ?? "missing", {
      timeout: 45_000,
    })
    .toBe(expected);
  return readScrollAreaState(serviceWorker);
}

test("@smoke captures nested scroll content and restores every scroll position", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/scroll-area.html");
  const tabId = await resolveTab(serviceWorker, targetPage);
  const target = targetPage.locator("#nested-scroll");
  await target.scrollIntoViewIfNeeded();
  const before = await targetPage.evaluate(() => ({
    documentY: window.scrollY,
    targetTop: (document.querySelector("#nested-scroll") as HTMLElement).scrollTop,
    outerTop: (document.querySelector("#outer-scroll") as HTMLElement).scrollTop,
  }));
  const dimensions = await target.evaluate((element) => ({
    width: element.scrollWidth,
    height: element.scrollHeight,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
  }));
  const popup = await openPopup();
  await startScrollAreaSelection(popup);
  await targetPage.bringToFront();
  await selectContainer(targetPage, target);

  const state = await waitForState(serviceWorker, "completed");
  expect(state.job).toMatchObject({
    state: "completed",
    activeEngine: "scroll",
    activeOutputFormat: "pdf",
    cleanupCompleted: true,
    outputArtifactId: expect.any(String),
    output: {
      artifactId: expect.any(String),
      format: "pdf",
      mimeType: "application/pdf",
      byteLength: expect.any(Number),
      pageCount: expect.any(Number),
    },
    targetRect: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
    descriptor: { captureKind: "full-scroll-content", scrollable: true },
  });
  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);
  expect(state.job?.output?.byteLength).toBeGreaterThan(0);
  expect(state.job?.output?.pageCount).toBeGreaterThan(0);
  expect(state.tiles.length).toBeGreaterThan(1);
  expect(state.tiles.every((tile) => tile.blobSize > 0 && tile.captureCrop !== null)).toBe(true);
  expect(state.tiles[0]?.captureCrop).toMatchObject({
    width: dimensions.clientWidth,
    height: dimensions.clientHeight,
  });
  expect(state.tiles.some((tile) => tile.row > 0 && tile.hiddenSticky > 0)).toBe(true);
  const after = await targetPage.evaluate(() => ({
    documentY: window.scrollY,
    targetTop: (document.querySelector("#nested-scroll") as HTMLElement).scrollTop,
    outerTop: (document.querySelector("#outer-scroll") as HTMLElement).scrollTop,
  }));
  expect(after).toEqual(before);

  await targetPage.bringToFront();
  await serviceWorker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
  const resultPopup = await openPopup();
  const result = resultPopup.getByTestId("tiled-output-result");
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result).toHaveAttribute("data-format", "pdf");
  await expect(result.getByRole("heading", { name: "PDF đã sẵn sàng" })).toBeVisible();
});

test("@smoke covers a wide scroll area with a two-dimensional internal grid", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/scroll-area.html");
  const target = targetPage.locator("#wide-scroll");
  await target.scrollIntoViewIfNeeded();
  const before = await target.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
    width: element.scrollWidth,
    height: element.scrollHeight,
  }));
  const popup = await openPopup();
  await startScrollAreaSelection(popup);
  await targetPage.bringToFront();
  await selectContainer(targetPage, target);

  const state = await waitForState(serviceWorker, "completed");
  expect(state.job).toMatchObject({
    state: "completed",
    activeOutputFormat: "pdf",
    outputArtifactId: expect.any(String),
    output: {
      artifactId: expect.any(String),
      format: "pdf",
      mimeType: "application/pdf",
      byteLength: expect.any(Number),
      pageCount: expect.any(Number),
    },
  });
  expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);
  expect(state.job?.targetRect).toEqual({ x: 0, y: 0, width: before.width, height: before.height });
  expect(new Set(state.tiles.map((tile) => tile.column)).size).toBeGreaterThan(1);
  expect(new Set(state.tiles.map((tile) => tile.row)).size).toBeGreaterThan(1);
  const right = Math.max(
    ...state.tiles.map((tile) => (tile.outputRect?.x ?? 0) + (tile.outputRect?.width ?? 0)),
  );
  const bottom = Math.max(
    ...state.tiles.map((tile) => (tile.outputRect?.y ?? 0) + (tile.outputRect?.height ?? 0)),
  );
  expect(right).toBe(before.width);
  expect(bottom).toBe(before.height);
  await expect(target).toHaveJSProperty("scrollLeft", before.left);
  await expect(target).toHaveJSProperty("scrollTop", before.top);
});

test("@smoke fails a stale modal scroll target without storing replacement tiles", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/scroll-area.html");
  const beforeDocumentY = await targetPage.evaluate(() => window.scrollY);
  const popup = await openPopup();
  await startScrollAreaSelection(popup);
  await targetPage.bringToFront();
  const target = targetPage.locator("#modal-scroll");
  const box = await target.boundingBox();
  if (box === null) throw new Error("Modal scroll target is not visible.");
  await targetPage.mouse.click(box.x + 40, box.y + 40);
  await targetPage.evaluate(() => document.querySelector("#modal-scroll")?.remove());
  await targetPage.keyboard.press("Enter");

  const state = await waitForState(serviceWorker, "failed");
  expect(state.job).toMatchObject({
    state: "failed",
    cleanupCompleted: true,
    errorCode: "E_TARGET_STALE",
  });
  expect(state.tiles).toEqual([]);
  expect(await targetPage.evaluate(() => window.scrollY)).toBe(beforeDocumentY);
});
