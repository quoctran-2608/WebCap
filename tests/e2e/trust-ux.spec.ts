import { expect, test } from "./extension.fixture";

test("localizes trust UX, persists English, and copies allowlisted diagnostics @smoke", async ({
  context,
  extensionId,
  openPopup,
  targetPage,
}) => {
  const externalRequests: string[] = [];
  context.on("request", (request) => {
    const url = request.url();
    if (/^https?:/u.test(url) && !url.startsWith("http://127.0.0.1:4174/")) {
      externalRequests.push(url);
    }
  });

  let popup = await openPopup();
  await popup.getByTestId("locale-select").selectOption("en");
  await expect(popup.getByRole("heading", { name: "Capture visible area" })).toBeVisible();
  await expect(
    popup.getByText("Images, source tiles, and PDFs are processed locally and are never uploaded."),
  ).toBeVisible();

  await popup.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          (
            globalThis as typeof globalThis & { __webcapCopiedDiagnostics?: string }
          ).__webcapCopiedDiagnostics = value;
          return Promise.resolve();
        },
      },
    });
  });
  await popup.getByTestId("copy-diagnostics").click();
  await expect(popup.getByText("Safe diagnostics JSON copied.")).toBeVisible();
  const diagnostics = await popup.evaluate(
    () =>
      (globalThis as typeof globalThis & { __webcapCopiedDiagnostics?: string })
        .__webcapCopiedDiagnostics,
  );
  expect(diagnostics).toBeTruthy();
  const parsed = JSON.parse(diagnostics ?? "{}") as Record<string, unknown>;
  expect(parsed).toMatchObject({ schemaVersion: 1, locale: "en", surface: "popup" });
  const serialized = JSON.stringify(parsed).toLowerCase();
  for (const forbidden of ["127.0.0.1", "visible-capture", "cookie", "token", "base64"]) {
    expect(serialized).not.toContain(forbidden);
  }

  await popup.close();
  popup = await openPopup();
  await expect(popup.getByTestId("locale-select")).toHaveValue("en");
  await expect(popup.getByRole("heading", { name: "Capture visible area" })).toBeVisible();

  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/editor.html`);
  await expect(editor.getByRole("heading", { name: "PDF editor" })).toBeVisible();
  await expect(editor.getByText("The editor URL does not contain a valid jobId.")).toBeVisible();
  await editor.close();

  await popup.getByRole("button", { name: /^Custom region/ }).click();
  await popup.getByRole("button", { name: "Start region selection" }).click();
  await targetPage.bringToFront();
  const selector = targetPage.locator("[data-webcap-region-selector]");
  await expect(selector).toHaveCount(1);
  await expect(selector.getByRole("dialog", { name: "Select a region to capture" })).toBeVisible();
  await expect(selector.getByRole("button", { name: "Cancel" })).toBeVisible();
  await targetPage.keyboard.press("Escape");
  await expect(selector).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test("explains Chrome-restricted pages without exposing raw URL data @smoke", async ({
  context,
  extensionId,
  serviceWorker,
  targetPage,
}) => {
  const target = await serviceWorker.evaluate(async (fixtureUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === fixtureUrl);
    if (tab?.id === undefined || tab.windowId === undefined) {
      throw new Error("The fixture tab could not be resolved before restricted navigation.");
    }
    return { tabId: tab.id, windowId: tab.windowId };
  }, targetPage.url());

  await targetPage.goto("chrome://settings/");
  await serviceWorker.evaluate(async ({ tabId, windowId }) => {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  }, target);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await serviceWorker.evaluate(async ({ tabId, windowId }) => {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  }, target);
  await popup.reload();
  await popup.waitForLoadState("domcontentloaded");

  await expect(popup.getByTestId("worker-status")).toHaveAttribute("data-status", "connected");
  await expect(popup.getByTestId("restricted-page-copy")).toContainText(
    "Chrome không cho phép extension chụp trang nội bộ",
  );
  await expect(popup.getByRole("button", { name: "Tạo bản xem trước" })).toBeDisabled();
});
