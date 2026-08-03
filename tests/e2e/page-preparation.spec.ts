import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface PreparationOptions {
  targetStartX: number;
  targetStartY: number;
  maxCssHeight: number;
  lazyLoad: {
    enabled: boolean;
    stepRatio: number;
    settleMs: number;
    maxDurationMs: number;
  };
}

const baseOptions: PreparationOptions = {
  targetStartX: 0,
  targetStartY: 0,
  maxCssHeight: 100_000,
  lazyLoad: {
    enabled: false,
    stepRatio: 0.8,
    settleMs: 60,
    maxDurationMs: 2_000,
  },
};

async function resolveFixtureTab(serviceWorker: Worker, page: Page): Promise<number> {
  return serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined) {
      throw new Error("The page-preparation fixture tab could not be resolved.");
    }
    return tab.id;
  }, page.url());
}

async function injectContentScript(serviceWorker: Worker, tabId: number): Promise<void> {
  await serviceWorker.evaluate(async (id) => {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      files: ["content-script.js"],
    });
  }, tabId);
}

async function sendContentMessage(
  serviceWorker: Worker,
  tabId: number,
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return serviceWorker.evaluate(
    async ({ id, payload }) =>
      (await chrome.tabs.sendMessage(id, payload)) as Record<string, unknown>,
    { id: tabId, payload: message },
  );
}

function prepareMessage(
  preparationId: string,
  options: PreparationOptions,
): Record<string, unknown> {
  return {
    protocolVersion: 1,
    requestId: `prepare-${preparationId}`,
    source: "background",
    target: "content",
    type: "PAGE_PREPARATION_PREPARE",
    payload: { preparationId, options },
    sentAt: new Date().toISOString(),
  };
}

function restoreMessage(preparationId: string): Record<string, unknown> {
  return {
    protocolVersion: 1,
    requestId: `restore-${preparationId}`,
    source: "background",
    target: "content",
    type: "PAGE_PREPARATION_RESTORE",
    payload: { preparationId },
    sentAt: new Date().toISOString(),
  };
}

function cancelMessage(preparationId: string): Record<string, unknown> {
  return {
    protocolVersion: 1,
    requestId: `cancel-${preparationId}`,
    source: "background",
    target: "content",
    type: "PAGE_PREPARATION_CANCEL",
    payload: { preparationId },
    sentAt: new Date().toISOString(),
  };
}

async function snapshotPage(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    htmlStyle: document.documentElement.getAttribute("style"),
    bodyStyle: document.body.getAttribute("style"),
    activeId: document.activeElement?.id ?? null,
    preparationStyles: document.querySelectorAll("style[data-webcap-preparation]").length,
  }));
}

test("@smoke prepares lazy content and restores page state", async ({
  serviceWorker,
  targetPage,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/lazy-images.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 420));
  await expect.poll(() => targetPage.evaluate(() => window.scrollY)).toBeGreaterThan(300);

  const before = await snapshotPage(targetPage);
  const initialHeight = await targetPage.evaluate(() => document.documentElement.scrollHeight);
  const tabId = await resolveFixtureTab(serviceWorker, targetPage);
  await injectContentScript(serviceWorker, tabId);

  const preparationId = "lazy-success";
  const ready = await sendContentMessage(
    serviceWorker,
    tabId,
    prepareMessage(preparationId, {
      ...baseOptions,
      lazyLoad: {
        enabled: true,
        stepRatio: 0.8,
        settleMs: 60,
        maxDurationMs: 4_000,
      },
    }),
  );

  expect(ready.type).toBe("PAGE_PREPARATION_READY");
  expect((ready.payload as { documentHeight: number }).documentHeight).toBeGreaterThan(
    initialHeight,
  );
  await expect.poll(() => targetPage.evaluate(() => window.scrollY)).toBeLessThan(2);
  await expect
    .poll(() => targetPage.evaluate(() => document.body.dataset.lazyLoaded ?? "0"))
    .toBe("4");
  expect(
    await targetPage.evaluate(
      () => document.querySelectorAll("style[data-webcap-preparation]").length,
    ),
  ).toBe(1);

  const restored = await sendContentMessage(serviceWorker, tabId, restoreMessage(preparationId));
  expect(restored.type).toBe("PAGE_PREPARATION_RESTORED");
  expect((restored.payload as { completed: boolean }).completed).toBe(true);

  const after = await snapshotPage(targetPage);
  expect(after).toEqual(before);
});

test("@smoke freezes animation, hides WebCap overlay, and preserves fixed elements", async ({
  serviceWorker,
  targetPage,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/animated-page.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 500));
  const animatedBefore = await snapshotPage(targetPage);
  let tabId = await resolveFixtureTab(serviceWorker, targetPage);
  await injectContentScript(serviceWorker, tabId);

  const animatedId = "animated-success";
  const animatedReady = await sendContentMessage(
    serviceWorker,
    tabId,
    prepareMessage(animatedId, baseOptions),
  );
  expect(animatedReady.type).toBe("PAGE_PREPARATION_READY");
  expect(
    await targetPage
      .locator("#animated")
      .evaluate((element) => getComputedStyle(element).animationPlayState),
  ).toBe("paused");
  expect(
    await targetPage
      .locator("#focus-target")
      .evaluate((element) => getComputedStyle(element).caretColor),
  ).toBe("rgba(0, 0, 0, 0)");
  await sendContentMessage(serviceWorker, tabId, restoreMessage(animatedId));
  expect(await snapshotPage(targetPage)).toEqual(animatedBefore);

  await targetPage.goto("http://127.0.0.1:4174/fixed-sticky.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 900));
  const fixedBefore = await snapshotPage(targetPage);
  const fixedStyleBefore = await targetPage.locator("#fixed").getAttribute("style");
  const overlayStyleBefore = await targetPage.locator("#overlay").getAttribute("style");
  tabId = await resolveFixtureTab(serviceWorker, targetPage);
  await injectContentScript(serviceWorker, tabId);

  const fixedId = "fixed-success";
  const fixedReady = await sendContentMessage(
    serviceWorker,
    tabId,
    prepareMessage(fixedId, baseOptions),
  );
  expect(fixedReady.type).toBe("PAGE_PREPARATION_READY");
  expect(await targetPage.locator("#fixed").getAttribute("style")).toBe(fixedStyleBefore);
  expect(
    await targetPage
      .locator("#overlay")
      .evaluate((element) => getComputedStyle(element).visibility),
  ).toBe("hidden");

  const restored = await sendContentMessage(serviceWorker, tabId, restoreMessage(fixedId));
  expect((restored.payload as { completed: boolean }).completed).toBe(true);
  expect(await targetPage.locator("#overlay").getAttribute("style")).toBe(overlayStyleBefore);
  expect(await snapshotPage(targetPage)).toEqual(fixedBefore);
});

test("@smoke restores automatically after unstable layout and cancellation", async ({
  serviceWorker,
  targetPage,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/layout-shift.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 300));
  const unstableBefore = await snapshotPage(targetPage);
  let tabId = await resolveFixtureTab(serviceWorker, targetPage);
  await injectContentScript(serviceWorker, tabId);

  const unstable = await sendContentMessage(
    serviceWorker,
    tabId,
    prepareMessage("unstable-error", {
      ...baseOptions,
      lazyLoad: { ...baseOptions.lazyLoad, settleMs: 40, maxDurationMs: 400 },
    }),
  );
  expect(unstable.type).toBe("PAGE_PREPARATION_ERROR");
  expect((unstable.payload as { code: string }).code).toBe("E_LAYOUT_UNSTABLE");
  expect(await snapshotPage(targetPage)).toEqual(unstableBefore);

  await targetPage.goto("http://127.0.0.1:4174/lazy-images.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 380));
  const cancelBefore = await snapshotPage(targetPage);
  tabId = await resolveFixtureTab(serviceWorker, targetPage);
  await injectContentScript(serviceWorker, tabId);
  const preparationId = "cancel-mid-prepare";

  const result = await serviceWorker.evaluate(
    async ({ id, prepare, cancel }) => {
      const pending = chrome.tabs.sendMessage(id, prepare) as Promise<Record<string, unknown>>;
      await new Promise((resolve) => setTimeout(resolve, 60));
      const cancelResponse = (await chrome.tabs.sendMessage(id, cancel)) as Record<string, unknown>;
      const prepareResponse = await pending;
      return { cancelResponse, prepareResponse };
    },
    {
      id: tabId,
      prepare: prepareMessage(preparationId, {
        ...baseOptions,
        lazyLoad: {
          enabled: true,
          stepRatio: 0.8,
          settleMs: 120,
          maxDurationMs: 5_000,
        },
      }),
      cancel: cancelMessage(preparationId),
    },
  );

  expect(result.cancelResponse.type).toBe("PAGE_PREPARATION_CANCELLED");
  expect((result.cancelResponse.payload as { accepted: boolean }).accepted).toBe(true);
  expect(result.prepareResponse.type).toBe("PAGE_PREPARATION_ERROR");
  expect((result.prepareResponse.payload as { code: string }).code).toBe("E_CANCELLED");
  expect(await snapshotPage(targetPage)).toEqual(cancelBefore);
});
