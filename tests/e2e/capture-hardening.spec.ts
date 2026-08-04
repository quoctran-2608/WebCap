import type { Page } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function expectColor(actual: Rgb, expected: Rgb, tolerance = 18): void {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(tolerance);
}

async function captureAndSample(
  popup: Page,
  points: Array<readonly [number, number]>,
): Promise<Rgb[]> {
  await popup
    .getByRole("button", { name: "Tạo bản xem trước" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(popup.getByTestId("preview-image")).toBeVisible({ timeout: 30_000 });
  return popup.getByTestId("preview-image").evaluate(async (node, samplePoints) => {
    const image = node as HTMLImageElement;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Preview canvas is unavailable.");
    context.drawImage(image, 0, 0);
    return samplePoints.map(([x, y]) => {
      const pixel = context.getImageData(
        Math.floor(canvas.width * x),
        Math.floor(canvas.height * y),
        1,
        1,
      ).data;
      return { r: pixel[0] ?? 0, g: pixel[1] ?? 0, b: pixel[2] ?? 0 };
    });
  }, points);
}

test("captures same-origin and cross-origin iframe pixels without DOM promises @smoke", async ({
  openPopup,
  targetPage,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/iframe-parent.html");
  await expect(targetPage.locator("iframe")).toHaveCount(2);
  await expect.poll(() => targetPage.frames().length).toBe(3);
  await targetPage.bringToFront();

  const popup = await openPopup();
  await targetPage.bringToFront();
  const [sameOrigin, crossOrigin] = await captureAndSample(popup, [
    [0.25, 0.25],
    [0.75, 0.25],
  ]);
  expectColor(sameOrigin ?? { r: 0, g: 0, b: 0 }, { r: 209, g: 73, b: 91 });
  expectColor(crossOrigin ?? { r: 0, g: 0, b: 0 }, { r: 209, g: 73, b: 91 });
});

test("captures deterministic Canvas 2D and WebGL pixels @smoke @dpr", async ({
  openPopup,
  targetPage,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/canvas-webgl.html");
  await expect
    .poll(() => targetPage.evaluate(() => document.body.dataset.webgl))
    .toMatch(/ready|fallback/);
  await targetPage.bringToFront();

  const popup = await openPopup();
  await targetPage.bringToFront();
  const [canvasPixel, webGlPixel] = await captureAndSample(popup, [
    [0.25, 0.5],
    [0.75, 0.5],
  ]);
  expectColor(canvasPixel ?? { r: 0, g: 0, b: 0 }, { r: 38, g: 70, b: 83 });
  expectColor(webGlPixel ?? { r: 0, g: 0, b: 0 }, { r: 11, g: 110, b: 79 });
});

test("shows an explicit partial warning when full-page capture reaches a height guard @smoke", async ({
  openPopup,
  serviceWorker,
  targetPage,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/long-page-10k.html");
  await targetPage.bringToFront();
  const tab = await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((candidate) => candidate.url === url);
    if (match?.id === undefined || match.windowId === undefined) {
      throw new Error("The hardening fixture tab could not be resolved.");
    }
    return { tabId: match.id, windowId: match.windowId };
  }, targetPage.url());

  let popup = await openPopup();
  const jobId = await popup.evaluate(async ({ tabId, windowId }) => {
    const requestId = crypto.randomUUID();
    const response: unknown = await chrome.runtime.sendMessage({
      protocolVersion: 1,
      requestId,
      source: "popup",
      target: "background",
      type: "JOB_CREATE",
      payload: {
        tabId,
        windowId,
        mode: "full-page",
        preferredEngine: "cdp",
        settings: {
          outputFormat: "png",
          imageQuality: 0.92,
          fixedElementMode: "smart",
          lazyLoad: { enabled: true, stepRatio: 0.8, settleMs: 60, maxDurationMs: 4_000 },
          limits: {
            maxCssHeight: 1_600,
            maxCssWidth: 20_000,
            maxTiles: 256,
            maxEstimatedBytes: 536_870_912,
          },
          pdf: { pageSize: "a4", orientation: "portrait", marginMm: 8, jpegQuality: 0.9 },
        },
      },
      sentAt: new Date().toISOString(),
    });
    const record = response as { payload?: { job?: { id?: string } } };
    const id = record.payload?.job?.id;
    if (typeof id !== "string") throw new Error("Job creation did not return an ID.");
    return id;
  }, tab);
  await popup.close();

  await expect
    .poll(
      () =>
        serviceWorker.evaluate(async (id) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("webcap-db", 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error("Database open failed."));
          });
          const transaction = database.transaction("jobs", "readonly");
          const request = transaction.objectStore("jobs").get(id);
          const job = await new Promise<{ state?: string; partialCapture?: { reason?: string } }>(
            (resolve, reject) => {
              request.onsuccess = () => resolve((request.result ?? {}) as never);
              request.onerror = () => reject(request.error ?? new Error("Job read failed."));
            },
          );
          return `${job.state ?? "missing"}:${job.partialCapture?.reason ?? "none"}`;
        }, jobId),
      { timeout: 45_000 },
    )
    .toBe("ready:max-css-height");

  popup = await openPopup();
  await expect(popup.getByTestId("partial-capture-warning")).toContainText("giới hạn chiều cao");
  await expect(popup.getByRole("button", { name: "Mở trình biên tập PDF" })).toBeVisible();
});
