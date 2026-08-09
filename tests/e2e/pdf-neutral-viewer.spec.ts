import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface DiscoveryState {
  state?: string;
  error?: unknown;
  documentPageMap?: {
    complete: boolean;
    sourcePageCount: number;
    pages: Array<{
      index: number;
      sourceRectCss: { x: number; y: number; width: number; height: number };
    }>;
  };
}

async function selectNeutralViewer(targetPage: Page): Promise<void> {
  const target = targetPage.locator("#neutral-scroll");
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("The neutral document viewer fixture is not visible.");
  const selector = targetPage.locator("[data-webcap-element-selector]");
  await targetPage.mouse.move(box.x + 8, box.y + box.height / 2);
  await targetPage.mouse.click(box.x + 8, box.y + box.height / 2);
  await expect(selector.locator("[data-label]")).toContainText("nội dung");
  await targetPage.keyboard.press("Enter");
  await expect(selector).toHaveCount(0);
}

async function readDiscoveryState(serviceWorker: Worker): Promise<DiscoveryState> {
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
    const jobs = values as Array<{
      mode: string;
      state: string;
      updatedAt: string;
      settings: { outputFormat: string };
      error?: unknown;
      documentPageMap?: DiscoveryState["documentPageMap"];
    }>;
    const job = jobs
      .filter(
        (candidate) =>
          candidate.mode === "scroll-area" && candidate.settings.outputFormat === "pdf",
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return job === undefined
      ? {}
      : {
          state: job.state,
          ...(job.error === undefined ? {} : { error: job.error }),
          ...(job.documentPageMap === undefined ? {} : { documentPageMap: job.documentPageMap }),
        };
  });
}

test("@smoke discovers a neutral 220-page document through explicit PDF intent", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  test.setTimeout(150_000);
  await targetPage.goto("http://127.0.0.1:4174/adaptive-long-page.html");
  await targetPage.setContent(`
    <!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <style>
          html, body { margin: 0; background: #ececec; font-family: Arial, sans-serif; }
          #neutral-scroll {
            width: 680px;
            height: 520px;
            overflow: auto;
            margin: 20px;
            padding: 20px;
            box-sizing: border-box;
            background: #2f2f2f;
          }
          #neutral-stack { width: 580px; margin: 0 auto; }
          .batch { width: 580px; }
          .unit {
            width: 560px;
            height: 760px;
            box-sizing: border-box;
            margin: 0 auto 18px;
            padding: 42px;
            background: white;
            color: #111;
          }
        </style>
      </head>
      <body>
        <div id="neutral-scroll">
          <div id="neutral-stack"></div>
        </div>
        <script>
          const stack = document.getElementById("neutral-stack");
          for (let batchIndex = 0; batchIndex < 4; batchIndex += 1) {
            const batch = document.createElement("div");
            batch.className = "batch";
            stack.append(batch);
            for (let offset = 0; offset < 55; offset += 1) {
              const index = batchIndex * 55 + offset;
              const node = document.createElement("section");
              node.className = "unit";
              node.innerHTML = "<h2>Mục " + (index + 1) + "</h2><p>Nội dung kiểm thử " + (index + 1) + "</p>";
              batch.append(node);
            }
          }
        </script>
      </body>
    </html>
  `);

  const popup = await openPopup();
  await popup.getByRole("button", { name: "Chụp PDF đang hiển thị" }).click();
  await targetPage.bringToFront();
  await selectNeutralViewer(targetPage);

  await expect
    .poll(
      async () => {
        const state = await readDiscoveryState(serviceWorker);
        if (state.state === "failed") {
          throw new Error(`Neutral PDF discovery failed: ${JSON.stringify(state.error)}`);
        }
        return state.documentPageMap?.sourcePageCount ?? 0;
      },
      { timeout: 110_000 },
    )
    .toBe(220);

  const state = await readDiscoveryState(serviceWorker);
  expect(state.documentPageMap?.complete).toBe(true);
  expect(state.documentPageMap?.pages).toHaveLength(220);
  expect(state.documentPageMap?.pages[0]?.sourceRectCss.height).toBeGreaterThan(700);
  expect(state.documentPageMap?.pages[219]?.sourceRectCss.y).toBeGreaterThan(160_000);
});
