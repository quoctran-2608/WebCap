import type { Locator, Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface RegionOpenResponse {
  type: string;
  payload: {
    jobId: string;
    selectorInstanceId: string;
    reused: boolean;
    capabilities: {
      pointerCreate: boolean;
      keyboardCreate: boolean;
      autoScroll: boolean;
      resizeHandles: number;
    };
  };
}

async function resolveTab(serviceWorker: Worker, page: Page): Promise<number> {
  return serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined) throw new Error("Region fixture tab was not found.");
    return tab.id;
  }, page.url());
}

async function latestRegionJobId(serviceWorker: Worker): Promise<string> {
  return serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open WebCap database."));
    });
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction("jobs", "readonly");
      const request = transaction.objectStore("jobs").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to read WebCap jobs."));
    });
    database.close();
    const job = (values as Array<{ id: string; mode: string; updatedAt: string }>)
      .filter((candidate) => candidate.mode === "region")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (job === undefined) throw new Error("Region job was not created.");
    return job.id;
  });
}

async function waitForRegionReady(serviceWorker: Worker, jobId: string): Promise<void> {
  await expect
    .poll(
      () =>
        serviceWorker.evaluate(async (id) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("webcap-db", 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error("Unable to open database."));
          });
          const job = await new Promise<{ state?: string } | undefined>((resolve, reject) => {
            const transaction = database.transaction("jobs", "readonly");
            const request = transaction.objectStore("jobs").get(id);
            request.onsuccess = () => resolve(request.result as { state?: string } | undefined);
            request.onerror = () => reject(request.error ?? new Error("Unable to read job."));
          });
          database.close();
          return job?.state ?? "missing";
        }, jobId),
      { timeout: 45_000 },
    )
    .toBe("ready");
}

async function launchRegionSelector(popup: Page, targetPage: Page): Promise<Locator> {
  await popup.getByRole("button", { name: /^Vùng tự chọn/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp vùng tự chọn" })).toBeVisible();
  const root = targetPage.locator("[data-webcap-region-selector]");
  await Promise.all([
    popup.waitForEvent("close"),
    popup.getByRole("button", { name: "Bắt đầu chọn vùng" }).click(),
  ]);
  await targetPage.bringToFront();
  await expect(root).toHaveCount(1, { timeout: 500 });
  return root;
}

test("@smoke closes popup only after a focused ready selector and reuses duplicate opens", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/region-selection.html");
  const tabId = await resolveTab(serviceWorker, targetPage);
  const root = await launchRegionSelector(await openPopup(), targetPage);
  const jobId = await latestRegionJobId(serviceWorker);

  const responses = (await serviceWorker.evaluate(
    async ({ id, job }) => {
      const makeMessage = (requestId: string) => ({
        protocolVersion: 1,
        requestId,
        source: "background" as const,
        target: "content" as const,
        type: "REGION_SELECTION_OPEN" as const,
        payload: { jobId: job },
        sentAt: new Date().toISOString(),
      });
      return Promise.all([
        chrome.tabs.sendMessage(id, makeMessage("duplicate-open-1")),
        chrome.tabs.sendMessage(id, makeMessage("duplicate-open-2")),
      ]);
    },
    { id: tabId, job: jobId },
  )) as RegionOpenResponse[];

  expect(responses[0]).toMatchObject({
    type: "REGION_SELECTION_OPENED",
    payload: {
      jobId,
      reused: true,
      capabilities: {
        pointerCreate: true,
        keyboardCreate: true,
        autoScroll: true,
        resizeHandles: 8,
      },
    },
  });
  expect(responses[1]).toMatchObject({
    type: "REGION_SELECTION_OPENED",
    payload: { jobId, reused: true },
  });
  const firstResponse = responses[0];
  const secondResponse = responses[1];
  expect(firstResponse).toBeDefined();
  expect(secondResponse).toBeDefined();
  if (firstResponse === undefined || secondResponse === undefined) {
    throw new Error("Duplicate region-open responses were missing.");
  }
  expect(firstResponse.payload.selectorInstanceId).toBe(secondResponse.payload.selectorInstanceId);
  await expect(root).toHaveCount(1);
  expect(
    await root.evaluate((node) => node.shadowRoot?.activeElement?.getAttribute("role") ?? null),
  ).toBe("dialog");
});

test("@smoke creates, moves, resizes, and commits a region using only the keyboard", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/region-selection.html");
  const root = await launchRegionSelector(await openPopup(), targetPage);
  const jobId = await latestRegionJobId(serviceWorker);

  await targetPage.keyboard.press("Space");
  const selection = root.locator("[data-selection]");
  await expect(selection).toBeVisible();
  const initial = await selection.boundingBox();
  expect(initial).not.toBeNull();

  const handles = root.locator("[data-handle]");
  await expect(handles).toHaveCount(8);
  for (let index = 0; index < 8; index += 1) {
    const box = await handles.nth(index).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  }

  await targetPage.keyboard.press("ArrowRight");
  await targetPage.keyboard.press("Shift+ArrowDown");
  await targetPage.keyboard.press("Alt+Shift+ArrowRight");
  const adjusted = await selection.boundingBox();
  expect(adjusted).not.toBeNull();
  expect(adjusted?.x).toBeCloseTo((initial?.x ?? 0) + 1, 0);
  expect(adjusted?.y).toBeCloseTo((initial?.y ?? 0) + 10, 0);
  expect(adjusted?.width).toBeCloseTo((initial?.width ?? 0) + 10, 0);

  await targetPage.keyboard.press("Enter");
  await expect(root).toHaveCount(0);
  await waitForRegionReady(serviceWorker, jobId);
});
