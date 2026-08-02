import { readFile } from "node:fs/promises";

import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function expectColor(actual: Rgb, expected: Rgb): void {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(12);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(12);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(12);
}

async function previewPixels(popup: Page): Promise<Rgb[]> {
  return popup.getByTestId("preview-image").evaluate(async (node) => {
    const image = node as HTMLImageElement;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Preview canvas context is unavailable.");
    }
    context.drawImage(image, 0, 0);

    const samplePoints: Array<readonly [number, number]> = [
      [0.125, 0.125],
      [0.875, 0.125],
      [0.125, 0.875],
      [0.875, 0.875],
    ];

    return samplePoints.map(([x, y]) => {
      const pixel = context.getImageData(
        Math.floor(canvas.width * x),
        Math.floor(canvas.height * y),
        1,
        1,
      ).data;
      return { r: pixel[0] ?? 0, g: pixel[1] ?? 0, b: pixel[2] ?? 0 };
    });
  });
}

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
    if (item === undefined) {
      throw new Error("Download item was not found.");
    }
    return { filename: item.filename, state: item.state };
  }, downloadId);
}

test("visible capture previews, restores, and downloads PNG @smoke", async ({
  openPopup,
  serviceWorker,
  targetPage,
}) => {
  const viewport = await targetPage.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));

  let popup = await openPopup();
  await expect(popup.getByTestId("worker-status")).toHaveAttribute("data-status", "connected");
  await expect(popup.getByTestId("tab-status")).toHaveAttribute("data-status", "supported");

  await popup.getByLabel("Định dạng đầu ra").selectOption("png");
  await targetPage.bringToFront();
  await popup
    .getByRole("button", { name: "Tạo bản xem trước" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(popup.getByTestId("preview-image")).toBeVisible({ timeout: 30_000 });

  const metadata = popup.getByTestId("preview-metadata");
  await expect(metadata).toHaveAttribute("data-width", String(Math.round(viewport.width)));
  await expect(metadata).toHaveAttribute("data-height", String(Math.round(viewport.height)));
  await expect(metadata).toHaveAttribute("data-format", "png");

  const [topLeft, topRight, bottomLeft, bottomRight] = await previewPixels(popup);
  expectColor(topLeft ?? { r: 0, g: 0, b: 0 }, { r: 11, g: 110, b: 79 });
  expectColor(topRight ?? { r: 0, g: 0, b: 0 }, { r: 233, g: 196, b: 106 });
  expectColor(bottomLeft ?? { r: 0, g: 0, b: 0 }, { r: 244, g: 162, b: 97 });
  expectColor(bottomRight ?? { r: 0, g: 0, b: 0 }, { r: 38, g: 70, b: 83 });

  const artifactId = await popup.getByTestId("preview-card").getAttribute("data-artifact-id");
  expect(artifactId).toBeTruthy();
  await popup.close();

  popup = await openPopup();
  await expect(popup.getByTestId("preview-image")).toBeVisible();
  await expect(popup.getByTestId("preview-card")).toHaveAttribute(
    "data-artifact-id",
    artifactId ?? "",
  );

  await popup.getByRole("button", { name: "Tải xuống" }).click();
  const completion = popup.getByTestId("download-success");
  await expect(completion).toBeVisible({ timeout: 30_000 });
  const downloadId = Number(await completion.getAttribute("data-download-id"));
  expect(Number.isInteger(downloadId)).toBe(true);

  const download = await waitForDownload(serviceWorker, downloadId);
  expect(download.state).toBe("complete");
  const bytes = await readFile(download.filename);
  expect(bytes.byteLength).toBeGreaterThan(8);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

test("visible capture matches DPR 2 at 125% zoom @dpr", async ({
  openPopup,
  serviceWorker,
  targetPage,
}) => {
  await targetPage.bringToFront();
  await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined) {
      throw new Error("The fixture tab could not be resolved for zoom.");
    }
    await chrome.tabs.setZoom(tab.id, 1.25);
  }, targetPage.url());
  await targetPage.waitForTimeout(250);

  const viewport = await targetPage.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));

  const zoom = await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined) {
      throw new Error("The fixture tab could not be resolved for zoom verification.");
    }
    return chrome.tabs.getZoom(tab.id);
  }, targetPage.url());
  expect(zoom).toBeCloseTo(1.25, 2);
  expect(viewport.dpr).toBeCloseTo(2 * zoom, 2);

  const popup = await openPopup();
  await targetPage.bringToFront();
  await popup
    .getByRole("button", { name: "Tạo bản xem trước" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(popup.getByTestId("preview-image")).toBeVisible({ timeout: 30_000 });

  const metadata = popup.getByTestId("preview-metadata");
  await expect(metadata).toHaveAttribute("data-width", String(Math.round(viewport.width * zoom)));
  await expect(metadata).toHaveAttribute("data-height", String(Math.round(viewport.height * zoom)));
});
