import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

const fixtureOrigin = "http://127.0.0.1:4174";

async function waitForDownload(
  serviceWorker: Worker,
  downloadId: number,
): Promise<{ filename: string; state: string }> {
  await expect
    .poll(
      () =>
        serviceWorker.evaluate(async (id) => {
          const [item] = await chrome.downloads.search({ id });
          return item?.state ?? "missing";
        }, downloadId),
      { timeout: 20_000 },
    )
    .toBe("complete");

  return serviceWorker.evaluate(async (id) => {
    const [item] = await chrome.downloads.search({ id });
    if (item === undefined) throw new Error("Original PDF download item was not found.");
    return { filename: item.filename, state: item.state };
  }, downloadId);
}

async function navigatePdf(page: Page, path: string): Promise<void> {
  await page.goto(`${fixtureOrigin}${path}`, { waitUntil: "commit" }).catch(() => undefined);
  await expect.poll(() => page.url()).toContain(path.split("?")[0] ?? path);
  await page.waitForTimeout(350);
}

test("downloads byte-identical original PDF without rasterization @smoke", async ({
  openPopup,
  serviceWorker,
  targetPage,
}) => {
  const sourceUrl = `${fixtureOrigin}/public-sample.pdf`;
  const sourceBytes = new Uint8Array(await (await fetch(sourceUrl)).arrayBuffer());
  const expectedHash = createHash("sha256").update(sourceBytes).digest("hex");

  await navigatePdf(targetPage, "/public-sample.pdf");
  const popup = await openPopup();
  const card = popup.getByTestId("pdf-source-card");
  await expect(card).toHaveAttribute("data-status", "original-passthrough");
  await expect(card).toHaveAttribute("data-permission", "granted");

  await popup.getByRole("button", { name: "Tải PDF gốc" }).click();
  const success = popup.getByTestId("pdf-source-download-success");
  await expect(success).toBeVisible({ timeout: 30_000 });
  await expect(success).toHaveAttribute("data-checksum", expectedHash);
  const downloadId = Number(await success.getAttribute("data-download-id"));
  expect(Number.isInteger(downloadId)).toBe(true);

  const download = await waitForDownload(serviceWorker, downloadId);
  const downloadedBytes = new Uint8Array(await readFile(download.filename));
  expect(downloadedBytes).toEqual(sourceBytes);
  expect([...downloadedBytes.subarray(0, 5)]).toEqual([37, 80, 68, 70, 45]);
});

test("detects PDF by content type when URL has no PDF suffix @smoke", async ({
  openPopup,
  targetPage,
}) => {
  await navigatePdf(targetPage, "/pdf-download?id=content-type");
  const popup = await openPopup();
  const card = popup.getByTestId("pdf-source-card");
  await expect(card).toHaveAttribute("data-status", "original-passthrough");
  await expect(popup.getByRole("button", { name: "Tải PDF gốc" })).toBeVisible();
});

test("reports auth-required without creating an original artifact @smoke", async ({
  openPopup,
  serviceWorker,
  targetPage,
}) => {
  await targetPage.goto(`${fixtureOrigin}/auth-wrapper`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => targetPage.url()).toContain("/auth-required.pdf");
  await targetPage.waitForTimeout(350);
  const before = await serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
    if (!database.objectStoreNames.contains("artifacts")) return 0;
    return new Promise<number>((resolve, reject) => {
      const transaction = database.transaction("artifacts", "readonly");
      const request = transaction.objectStore("artifacts").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
  });

  const popup = await openPopup();
  const card = popup.getByTestId("pdf-source-card");
  await expect(card).toHaveAttribute("data-status", "auth-required");
  await expect(popup.getByText("Nguồn PDF cần đăng nhập")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Tải PDF gốc" })).toHaveCount(0);

  const after = await serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
    if (!database.objectStoreNames.contains("artifacts")) return 0;
    return new Promise<number>((resolve, reject) => {
      const transaction = database.transaction("artifacts", "readonly");
      const request = transaction.objectStore("artifacts").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
  });
  expect(after).toBe(before);
});
