import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface BenchmarkJob {
  mode: string;
  state: string;
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
  updatedAt: string;
  targetRect?: { height: number };
  cleanup: { completed: boolean };
  error?: { code: string; causeCode?: string };
}

async function resolveFixtureTab(serviceWorker: Worker, page: Page): Promise<number> {
  return serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined) {
      throw new Error("The 10k fallback fixture tab could not be resolved.");
    }
    return tab.id;
  }, page.url());
}

async function activateFixtureTab(serviceWorker: Worker, page: Page): Promise<void> {
  await page.bringToFront();
  await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined || tab.windowId === undefined) {
      throw new Error("The 10k fallback fixture tab could not be activated.");
    }
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }, page.url());
}

async function readLatestFullPageJob(serviceWorker: Worker): Promise<BenchmarkJob | undefined> {
  return serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open benchmark DB."));
    });
    const transaction = database.transaction("jobs", "readonly");
    const jobs = await new Promise<BenchmarkJob[]>((resolve, reject) => {
      const request = transaction.objectStore("jobs").getAll();
      request.onsuccess = () => resolve(request.result as BenchmarkJob[]);
      request.onerror = () => reject(request.error ?? new Error("Unable to read benchmark job."));
    });
    database.close();
    return jobs
      .filter((job) => job.mode === "full-page")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  });
}

test("@smoke captures a 10k CSS-pixel page through scroll fallback", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  test.setTimeout(90_000);
  await targetPage.goto("http://127.0.0.1:4174/long-page-10k.html");
  await targetPage.locator("#focus-target").focus();
  await targetPage.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => targetPage.evaluate(() => window.scrollY)).toBeGreaterThan(800);
  const originalScroll = await targetPage.evaluate(() => window.scrollY);
  const tabId = await resolveFixtureTab(serviceWorker, targetPage);
  await serviceWorker.evaluate(async (id) => chrome.debugger.attach({ tabId: id }, "1.3"), tabId);

  try {
    const popup = await openPopup();
    await popup.getByRole("button", { name: /^Toàn bộ trang/ }).click();
    const startedAt = Date.now();
    await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();
    await activateFixtureTab(serviceWorker, targetPage);
    await expect
      .poll(
        async () => {
          const job = await readLatestFullPageJob(serviceWorker);
          if (job?.state === "failed" || job?.state === "cancelled") {
            return `${job.state}:${job.error?.code ?? "unknown"}:${job.error?.causeCode ?? "unknown"}`;
          }
          return job?.state ?? "missing";
        },
        { timeout: 75_000 },
      )
      .toBe("completed");
    const durationMs = Date.now() - startedAt;

    const job = await readLatestFullPageJob(serviceWorker);
    expect(job).toMatchObject({
      state: "completed",
      activeEngine: "scroll",
      activeOutputFormat: "pdf",
      outputArtifactId: expect.any(String),
      output: {
        artifactId: expect.any(String),
        format: "pdf",
        mimeType: "application/pdf",
        byteLength: expect.any(Number),
        pageCount: expect.any(Number),
      },
      cleanup: { completed: true },
    });
    expect(job?.outputArtifactId).toBe(job?.output?.artifactId);
    expect(job?.output?.byteLength).toBeGreaterThan(0);
    expect(job?.targetRect?.height).toBeGreaterThanOrEqual(10_000);
    expect(job?.totalTiles).toBeGreaterThanOrEqual(19);
    expect(job?.completedTiles).toBe(job?.totalTiles);
    expect(durationMs).toBeLessThan(75_000);
    expect(await targetPage.evaluate(() => window.scrollY)).toBe(originalScroll);
    expect(
      await targetPage.evaluate(
        () => document.querySelectorAll("[data-webcap-scroll-preparation]").length,
      ),
    ).toBe(0);

    await popup.bringToFront();
    const result = popup.getByTestId("tiled-output-result");
    await expect(result).toBeVisible({ timeout: 5_000 });
    await expect(result).toHaveAttribute("data-format", "pdf");
  } finally {
    await serviceWorker
      .evaluate(async (id) => chrome.debugger.detach({ tabId: id }), tabId)
      .catch(() => undefined);
  }
});
