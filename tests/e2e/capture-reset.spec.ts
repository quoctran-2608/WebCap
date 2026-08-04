import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface PageSnapshot {
  scrollX: number;
  scrollY: number;
  activeId: string | null;
  htmlStyle: string | null;
  bodyStyle: string | null;
  preparationStyles: number;
  regionSelectors: number;
  elementSelectors: number;
}

async function snapshotPage(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => ({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    activeId: document.activeElement?.id ?? null,
    htmlStyle: document.documentElement.getAttribute("style"),
    bodyStyle: document.body.getAttribute("style"),
    preparationStyles: document.querySelectorAll("style[data-webcap-preparation]").length,
    regionSelectors: document.querySelectorAll("[data-webcap-region-selector]").length,
    elementSelectors: document.querySelectorAll("[data-webcap-element-selector]").length,
  }));
}

async function readVisibleResetState(
  serviceWorker: Worker,
): Promise<{ hasSession: boolean; artifactCount: number }> {
  return serviceWorker.evaluate(async () => {
    const session = await chrome.storage.session.get("webcap.visible-session");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open test database."));
    });
    const transaction = database.transaction("artifacts", "readonly");
    const artifacts = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore("artifacts").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to read artifacts."));
    });
    database.close();
    return {
      hasSession: session["webcap.visible-session"] !== undefined,
      artifactCount: artifacts.length,
    };
  });
}

async function readTiledResetState(serviceWorker: Worker): Promise<{
  job: { id: string; state: string } | null;
  jobCount: number;
  tileCount: number;
}> {
  return serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open test database."));
    });
    const transaction = database.transaction(["jobs", "tiles"], "readonly");
    const readAll = <T>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error ?? new Error(`Unable to read ${store}.`));
      });
    const [jobs, tiles] = await Promise.all([
      readAll<{ id: string; mode: string; state: string; updatedAt: string }>("jobs"),
      readAll<{ jobId: string }>("tiles"),
    ]);
    database.close();
    const latest = jobs
      .filter((candidate) => candidate.mode === "full-page")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return {
      job: latest === undefined ? null : { id: latest.id, state: latest.state },
      jobCount: jobs.length,
      tileCount: tiles.length,
    };
  });
}

async function selectFullPage(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Toàn bộ trang/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp toàn bộ trang" })).toBeVisible();
}

test("@smoke resets a visible result and starts a second capture", async ({
  openPopup,
  serviceWorker,
  targetPage,
}) => {
  const popup = await openPopup();
  await targetPage.bringToFront();
  await popup
    .getByRole("button", { name: "Tạo bản xem trước" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(popup.getByTestId("preview-card")).toBeVisible({ timeout: 30_000 });
  const firstArtifactId = await popup.getByTestId("preview-card").getAttribute("data-artifact-id");
  expect(firstArtifactId).toBeTruthy();

  await popup.getByRole("button", { name: "Chụp mới" }).click();
  await expect(popup.getByTestId("reset-success")).toBeVisible();
  await expect(popup.getByTestId("preview-card")).toHaveCount(0);
  await expect
    .poll(() => readVisibleResetState(serviceWorker), { timeout: 10_000 })
    .toEqual({ hasSession: false, artifactCount: 0 });
  await expect(popup.getByRole("button", { name: "Tạo bản xem trước" })).toBeEnabled();

  await targetPage.bringToFront();
  await popup
    .getByRole("button", { name: "Tạo bản xem trước" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(popup.getByTestId("preview-card")).toBeVisible({ timeout: 30_000 });
  const secondArtifactId = await popup.getByTestId("preview-card").getAttribute("data-artifact-id");
  expect(secondArtifactId).toBeTruthy();
  expect(secondArtifactId).not.toBe(firstArtifactId);
});

test("@smoke resets terminal and active full-page jobs without stale local data", async ({
  openPopup,
  serviceWorker,
  targetPage,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/full-page-long.html");
  const popup = await openPopup();
  await selectFullPage(popup);
  await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();
  await expect(popup.getByText("Tile set toàn trang đã sẵn sàng.")).toBeVisible({ timeout: 45_000 });

  const first = await readTiledResetState(serviceWorker);
  expect(first.job).toMatchObject({ state: "ready" });
  const firstJobId = first.job?.id;
  expect(firstJobId).toBeTruthy();

  await popup.getByRole("button", { name: "Chụp mới" }).click();
  await expect
    .poll(() => readTiledResetState(serviceWorker), { timeout: 10_000 })
    .toEqual({ job: null, jobCount: 0, tileCount: 0 });
  await expect(popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" })).toBeEnabled();

  await targetPage.goto("http://127.0.0.1:4174/lazy-images.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 380));
  await expect.poll(() => targetPage.evaluate(() => window.scrollY)).toBeGreaterThan(250);
  const beforeActiveReset = await snapshotPage(targetPage);

  await popup.bringToFront();
  await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();
  await expect
    .poll(async () => {
      const state = await readTiledResetState(serviceWorker);
      return state.job !== null && state.job.id !== firstJobId;
    })
    .toBe(true);

  await expect(popup.getByRole("button", { name: "Hủy và chụp mới" })).toBeVisible();
  popup.once("dialog", (dialog) => void dialog.accept());
  await popup.getByRole("button", { name: "Hủy và chụp mới" }).click();

  await expect
    .poll(() => readTiledResetState(serviceWorker), { timeout: 30_000 })
    .toEqual({ job: null, jobCount: 0, tileCount: 0 });
  await expect.poll(() => snapshotPage(targetPage), { timeout: 10_000 }).toEqual(beforeActiveReset);
  await expect(popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" })).toBeEnabled();
});
