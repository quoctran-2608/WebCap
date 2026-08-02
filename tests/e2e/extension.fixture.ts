import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  chromium,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";

interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  targetPage: Page;
  openPopup: () => Promise<Page>;
}

const fixtureUrl = "http://127.0.0.1:4174/visible-capture.html";

async function createTestExtension(sourcePath: string, destinationPath: string): Promise<void> {
  await cp(sourcePath, destinationPath, { recursive: true });
  const manifestPath = resolve(destinationPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    host_permissions?: string[];
  };
  manifest.host_permissions = ["<all_urls>"];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use, testInfo) => {
    const userDataDir = testInfo.outputPath("profile");
    const downloadsPath = testInfo.outputPath("downloads");
    const extensionPath = testInfo.outputPath("extension");
    await mkdir(downloadsPath, { recursive: true });
    await createTestExtension(resolve(import.meta.dirname, "../../dist"), extensionPath);

    const deviceScaleFactor = Number(testInfo.project.use.deviceScaleFactor ?? 1);
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      viewport: { width: 900, height: 600 },
      deviceScaleFactor,
      downloadsPath,
      acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let worker = context
      .serviceWorkers()
      .find((candidate) => candidate.url().startsWith("chrome-extension://"));
    worker ??= await context.waitForEvent("serviceworker", {
      predicate: (candidate) => candidate.url().startsWith("chrome-extension://"),
    });
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const extensionId = new URL(serviceWorker.url()).host;
    await use(extensionId);
  },

  targetPage: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(fixtureUrl);
    await page.bringToFront();
    await use(page);
  },

  openPopup: async ({ context, extensionId, serviceWorker, targetPage }, use) => {
    const openPopup = async (): Promise<Page> => {
      for (const page of context.pages()) {
        if (page.url().startsWith(`chrome-extension://${extensionId}/popup.html`)) {
          await page.close();
        }
      }

      await targetPage.bringToFront();
      const target = await serviceWorker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((candidate) => candidate.url === url);
        if (tab?.id === undefined || tab.windowId === undefined) {
          throw new Error("The fixture tab could not be resolved.");
        }
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return { windowId: tab.windowId };
      }, targetPage.url());

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await targetPage.bringToFront();
      await serviceWorker.evaluate(
        async ({ windowId, url }) => {
          const tabs = await chrome.tabs.query({ windowId });
          const tab = tabs.find((candidate) => candidate.url === url);
          if (tab?.id === undefined) {
            throw new Error("The fixture tab could not be reactivated.");
          }
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(windowId, { focused: true });
        },
        { windowId: target.windowId, url: targetPage.url() },
      );
      await popup.reload();
      await popup.waitForLoadState("domcontentloaded");
      return popup;
    };

    await use(openPopup);
  },
});

export { expect } from "@playwright/test";
