import { expect, test } from "./extension.fixture";

test("shows explicit PDF capture when source inspection is not-pdf @smoke", async ({
  openPopup,
  targetPage,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/adaptive-long-page.html", {
    waitUntil: "domcontentloaded",
  });
  const popup = await openPopup();
  await expect(popup.getByRole("button", { name: "Chụp PDF đang hiển thị" })).toBeVisible();
});
