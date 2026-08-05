import { expect, test } from "./extension.fixture";

const zoomLevels = [0.8, 1, 1.25, 1.5] as const;

test("validates visible capture across the release DPR and zoom matrix @release-matrix", async ({
  openPopup,
  serviceWorker,
  targetPage,
}) => {
  const baseDpr = Number(test.info().project.use.deviceScaleFactor ?? 1);
  await targetPage.bringToFront();
  const tabId = await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined) {
      throw new Error("The fixture tab could not be resolved for the release matrix.");
    }
    return tab.id;
  }, targetPage.url());

  try {
    for (const [index, zoom] of zoomLevels.entries()) {
      await serviceWorker.evaluate(async ({ id, factor }) => chrome.tabs.setZoom(id, factor), {
        id: tabId,
        factor: zoom,
      });
      await targetPage.waitForTimeout(250);

      const viewport = await targetPage.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      }));
      const actualZoom = await serviceWorker.evaluate(async (id) => chrome.tabs.getZoom(id), tabId);
      expect(actualZoom).toBeCloseTo(zoom, 2);
      expect(viewport.dpr).toBeCloseTo(baseDpr * zoom, 2);

      const popup = await openPopup();
      if (index > 0) {
        await popup.getByRole("button", { name: "Chụp mới" }).click();
        await expect(popup.getByTestId("reset-success")).toBeVisible();
        await expect(popup.getByRole("button", { name: "Tạo bản xem trước" })).toBeEnabled();
      }

      await targetPage.bringToFront();
      await popup
        .getByRole("button", { name: "Tạo bản xem trước" })
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect(popup.getByTestId("preview-image")).toBeVisible({ timeout: 30_000 });
      const metadata = popup.getByTestId("preview-metadata");
      await expect(metadata).toHaveAttribute(
        "data-width",
        String(Math.round(viewport.width * actualZoom)),
      );
      await expect(metadata).toHaveAttribute(
        "data-height",
        String(Math.round(viewport.height * actualZoom)),
      );
      await popup.close();
    }
  } finally {
    await serviceWorker
      .evaluate(async (id) => chrome.tabs.setZoom(id, 1), tabId)
      .catch(() => undefined);
  }
});
