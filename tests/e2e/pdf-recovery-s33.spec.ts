import { PDFDocument } from "pdf-lib";
import type { Browser, Page, Worker } from "@playwright/test";

import { createJobGetMessage } from "@shared/contracts/job-messages";

import { expect, test } from "./extension.fixture";

interface RecoveryState {
  id?: string;
  state?: string;
  completedTiles: number;
  totalTiles: number;
  exportProgress?: { completedPages: number; totalPages: number };
  documentPageCount?: number;
  output?: { artifactId: string; pageCount?: number; byteLength: number };
  error?: unknown;
  pdfBytes: number[];
}

async function startScrollAreaSelection(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Vùng cuộn/ }).click();
  await popup.getByRole("button", { name: "Bắt đầu chọn vùng cuộn" }).click();
}

async function selectViewer(page: Page): Promise<void> {
  const target = page.locator("#pdf-scroll");
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("The S33 recovery viewer is not visible.");
  const selector = page.locator("[data-webcap-element-selector]");
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  await expect(selector.locator("[data-label]")).toContainText("nội dung");
  await page.keyboard.press("Enter");
  await expect(selector).toHaveCount(0);
}

async function readRecoveryState(page: Page, jobId?: string): Promise<RecoveryState> {
  return page.evaluate(async (requestedJobId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open WebCap database."));
    });
    const read = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
      });
    const jobValues = await read<unknown[]>(
      database.transaction("jobs", "readonly").objectStore("jobs").getAll(),
    );
    const jobs = jobValues as Array<{
      id: string;
      mode: string;
      state: string;
      completedTiles: number;
      totalTiles: number;
      updatedAt: string;
      exportProgress?: { completedPages: number; totalPages: number };
      documentPageMap?: { sourcePageCount: number };
      outputArtifactId?: string;
      output?: { artifactId: string; pageCount?: number; byteLength: number };
      error?: unknown;
    }>;
    const job =
      (requestedJobId === undefined
        ? jobs
            .filter((candidate) => candidate.mode === "scroll-area")
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
        : jobs.find((candidate) => candidate.id === requestedJobId)) ?? undefined;

    let pdfBytes: number[] = [];
    if (job?.outputArtifactId !== undefined) {
      const artifact = (await read<unknown>(
        database
          .transaction("artifacts", "readonly")
          .objectStore("artifacts")
          .get(job.outputArtifactId),
      )) as { blob?: Blob; opfsReference?: string } | undefined;
      let blob = artifact?.blob;
      if (blob === undefined && artifact?.opfsReference !== undefined) {
        const prefix = "webcap-pdf-output/";
        if (!artifact.opfsReference.startsWith(prefix)) {
          throw new Error("Unexpected S33 PDF spool reference.");
        }
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle("webcap-pdf-output");
        const handle = await directory.getFileHandle(artifact.opfsReference.slice(prefix.length));
        blob = await handle.getFile();
      }
      if (blob !== undefined) pdfBytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    }
    database.close();
    return job === undefined
      ? { completedTiles: 0, totalTiles: 0, pdfBytes }
      : {
          id: job.id,
          state: job.state,
          completedTiles: job.completedTiles,
          totalTiles: job.totalTiles,
          ...(job.exportProgress === undefined ? {} : { exportProgress: job.exportProgress }),
          ...(job.documentPageMap === undefined
            ? {}
            : { documentPageCount: job.documentPageMap.sourcePageCount }),
          ...(job.output === undefined ? {} : { output: job.output }),
          ...(job.error === undefined ? {} : { error: job.error }),
          pdfBytes,
        };
  }, jobId);
}

async function restartExtensionWorker(
  worker: Worker,
  popup: Page,
  targetPage: Page,
  jobId: string,
): Promise<void> {
  const browser = popup.context().browser();
  if (browser === null) throw new Error("Chromium browser instance is unavailable.");
  const workerUrl = worker.url();
  const session = await browser.newBrowserCDPSession();
  try {
    await session.send("Target.setDiscoverTargets", { discover: true });
    const targets = (await session.send("Target.getTargets")) as {
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    };
    const target = targets.targetInfos.find(
      (candidate) => candidate.type === "service_worker" && candidate.url === workerUrl,
    );
    if (target === undefined) throw new Error("Live WebCap service worker target is unavailable.");
    await session.send("Target.closeTarget", { targetId: target.targetId });
  } finally {
    await session.detach();
  }
  await expect
    .poll(
      () =>
        worker
          .evaluate(() => true)
          .then(
            () => false,
            () => true,
          ),
      { timeout: 10_000 },
    )
    .toBe(true);
  await targetPage.bringToFront();
  const request = createJobGetMessage({
    requestId: crypto.randomUUID(),
    jobId,
    sentAt: new Date().toISOString(),
  });
  const response: unknown = await popup.evaluate(async (message): Promise<unknown> => {
    const value: unknown = await chrome.runtime.sendMessage(message);
    return value;
  }, request);
  if (
    typeof response !== "object" ||
    response === null ||
    !("type" in response) ||
    response.type !== "JOB_RESPONSE"
  ) {
    throw new Error(`Unable to wake restarted WebCap runtime: ${JSON.stringify(response)}`);
  }
}

async function closeOffscreenDocument(browser: Browser, worker: Worker): Promise<void> {
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const session = await browser.newBrowserCDPSession();
  try {
    await session.send("Target.setDiscoverTargets", { discover: true });
    const targets = (await session.send("Target.getTargets")) as {
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    };
    const target = targets.targetInfos.find(
      (candidate) => candidate.url === `${origin}/offscreen.html`,
    );
    if (target === undefined) throw new Error("WebCap offscreen document target is unavailable.");
    await session.send("Target.closeTarget", { targetId: target.targetId });
  } finally {
    await session.detach();
  }
}

async function createRecoveryJob(
  targetPage: Page,
  openPopup: () => Promise<Page>,
): Promise<{ jobId: string; popup: Page }> {
  await targetPage.goto("http://127.0.0.1:4174/pdf-recovery-viewer.html");
  const startPopup = await openPopup();
  await startScrollAreaSelection(startPopup);
  await targetPage.bringToFront();
  await selectViewer(targetPage);
  const popup = await openPopup();
  await expect
    .poll(async () => (await readRecoveryState(popup)).id ?? "", { timeout: 15_000 })
    .not.toBe("");
  const state = await readRecoveryState(popup);
  if (state.id === undefined) throw new Error("S33 recovery job was not created.");
  return { jobId: state.id, popup };
}

async function assertCompletedPdf(popup: Page, jobId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await readRecoveryState(popup, jobId);
        if (state.state === "failed") {
          throw new Error(`S33 recovery failed: ${JSON.stringify(state.error)}`);
        }
        return state.state ?? "missing";
      },
      { timeout: 150_000 },
    )
    .toBe("completed");
  const state = await readRecoveryState(popup, jobId);
  expect(state.documentPageCount).toBe(24);
  expect(state.completedTiles).toBe(state.totalTiles);
  expect(state.output?.pageCount).toBe(24);
  expect(state.pdfBytes.length).toBeGreaterThan(4);
  expect(String.fromCharCode(...state.pdfBytes.slice(0, 5))).toBe("%PDF-");
  const document = await PDFDocument.load(Uint8Array.from(state.pdfBytes));
  expect(document.getPageCount()).toBe(24);
}

test("@smoke resumes page-native PDF capture after a service-worker restart", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  test.setTimeout(180_000);
  const { jobId, popup } = await createRecoveryJob(targetPage, openPopup);
  await expect
    .poll(
      async () => {
        const state = await readRecoveryState(popup, jobId);
        return state.state === "capturing" && state.completedTiles > 0 ? state.completedTiles : 0;
      },
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);
  const before = await readRecoveryState(popup, jobId);
  await restartExtensionWorker(serviceWorker, popup, targetPage, jobId);
  await assertCompletedPdf(popup, jobId);
  const final = await readRecoveryState(popup, jobId);
  expect(final.completedTiles).toBeGreaterThanOrEqual(before.completedTiles);
});

test("@smoke resumes streamed PDF output after the offscreen document is killed", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  test.setTimeout(180_000);
  const { jobId, popup } = await createRecoveryJob(targetPage, openPopup);
  await expect
    .poll(
      async () => {
        const state = await readRecoveryState(popup, jobId);
        const progress = state.exportProgress;
        return state.state === "exporting" && (progress?.completedPages ?? 0) > 0
          ? (progress?.completedPages ?? 0)
          : 0;
      },
      { timeout: 90_000 },
    )
    .toBeGreaterThan(0);

  const browser = popup.context().browser();
  if (browser === null) throw new Error("Chromium browser instance is unavailable.");
  await closeOffscreenDocument(browser, serviceWorker);
  await expect
    .poll(
      async () => {
        const state = await readRecoveryState(popup, jobId);
        if (state.state === "failed") {
          throw new Error(`S33 offscreen recovery failed: ${JSON.stringify(state.error)}`);
        }
        return state.state ?? "missing";
      },
      { timeout: 20_000 },
    )
    .toBe("paused");
  const paused = await readRecoveryState(popup, jobId);
  expect(paused.exportProgress?.completedPages ?? 0).toBeGreaterThan(0);
  expect(paused.exportProgress?.completedPages ?? 24).toBeLessThan(24);

  await restartExtensionWorker(serviceWorker, popup, targetPage, jobId);
  await assertCompletedPdf(popup, jobId);
});
