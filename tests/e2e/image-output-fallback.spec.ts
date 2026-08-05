import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface FallbackState {
  job: {
    id: string;
    state: string;
    stateRevision: number;
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
    errorCode?: string;
    errorFallbackAllowed?: boolean;
    errorCause?: string;
  } | null;
  tiles: Array<{
    tileId: string;
    index: number;
    blobSize: number;
  }>;
  outputArtifacts: Array<{
    artifactId: string;
    format: string;
    mimeType: string;
    byteLength: number;
    pageCount?: number;
  }>;
}

async function resolveTab(serviceWorker: Worker, page: Page): Promise<number> {
  return serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab?.id === undefined) throw new Error("The fallback fixture tab could not be resolved.");
    return tab.id;
  }, page.url());
}

async function startRegionSelection(popup: Page, targetPage: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Vùng tự chọn/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp vùng tự chọn" })).toBeVisible();
  await Promise.all([
    popup.waitForEvent("close"),
    popup.getByRole("button", { name: "Bắt đầu chọn vùng" }).click(),
  ]);
  await targetPage.bringToFront();
  await expect(targetPage.locator("[data-webcap-region-selector]")).toHaveCount(1, {
    timeout: 500,
  });
}

async function readFallbackState(serviceWorker: Worker): Promise<FallbackState> {
  return serviceWorker.evaluate(async () => {
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
    const transaction = database.transaction(["jobs", "tiles", "artifacts"], "readonly");
    const [jobValues, tileValues, artifactValues] = await Promise.all([
      read<unknown[]>(transaction.objectStore("jobs").getAll()),
      read<unknown[]>(transaction.objectStore("tiles").getAll()),
      read<unknown[]>(transaction.objectStore("artifacts").getAll()),
    ]);
    const jobs = jobValues as Array<{
      id: string;
      mode: string;
      state: string;
      stateRevision: number;
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
      error?: { code: string; fallbackAllowed?: boolean; causeCode?: string };
    }>;
    const job = jobs
      .filter((candidate) => candidate.mode === "region")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const tiles = (
      tileValues as Array<{
        jobId: string;
        index: number;
        tile: { id: string };
        blob?: Blob;
      }>
    )
      .filter((record) => job !== undefined && record.jobId === job.id)
      .sort((left, right) => left.index - right.index)
      .map((record) => ({
        tileId: record.tile.id,
        index: record.index,
        blobSize: record.blob?.size ?? 0,
      }));
    const outputArtifacts = (
      artifactValues as Array<{
        jobId?: string;
        role?: string;
        artifactId: string;
        format: string;
        mimeType: string;
        byteLength: number;
        pageCount?: number;
      }>
    )
      .filter(
        (artifact) =>
          job !== undefined && artifact.jobId === job.id && artifact.role === "output",
      )
      .map((artifact) => ({
        artifactId: artifact.artifactId,
        format: artifact.format,
        mimeType: artifact.mimeType,
        byteLength: artifact.byteLength,
        ...(artifact.pageCount === undefined ? {} : { pageCount: artifact.pageCount }),
      }));
    database.close();
    return {
      job:
        job === undefined
          ? null
          : {
              id: job.id,
              state: job.state,
              stateRevision: job.stateRevision,
              ...(job.activeOutputFormat === undefined
                ? {}
                : { activeOutputFormat: job.activeOutputFormat }),
              ...(job.outputArtifactId === undefined
                ? {}
                : { outputArtifactId: job.outputArtifactId }),
              ...(job.output === undefined ? {} : { output: job.output }),
              completedTiles: job.completedTiles,
              totalTiles: job.totalTiles,
              ...(job.error === undefined
                ? {}
                : {
                    errorCode: job.error.code,
                    ...(job.error.fallbackAllowed === undefined
                      ? {}
                      : { errorFallbackAllowed: job.error.fallbackAllowed }),
                    ...(job.error.causeCode === undefined
                      ? {}
                      : { errorCause: job.error.causeCode }),
                  }),
            },
      tiles,
      outputArtifacts,
    };
  });
}

async function waitForRegionState(
  serviceWorker: Worker,
  expectedState: "completed" | "failed",
): Promise<FallbackState> {
  await expect
    .poll(async () => (await readFallbackState(serviceWorker)).job?.state ?? "missing", {
      timeout: 45_000,
    })
    .toBe(expectedState);
  return readFallbackState(serviceWorker);
}

async function forceOversizedImageFailure(serviceWorker: Worker, jobId: string): Promise<void> {
  await serviceWorker.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open WebCap database."));
    });
    const transaction = database.transaction(["jobs", "artifacts"], "readwrite");
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Unable to persist the fallback fixture."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("The fallback fixture transaction was aborted."));
    });
    const jobs = transaction.objectStore("jobs");
    const artifacts = transaction.objectStore("artifacts");
    const job = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = jobs.get(id);
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error ?? new Error("Unable to read the region job."));
    });
    if (job === undefined) throw new Error("The completed region job could not be resolved.");

    const outputArtifactId =
      typeof job.outputArtifactId === "string" ? job.outputArtifactId : undefined;
    const stateRevision =
      typeof job.stateRevision === "number" ? job.stateRevision + 1 : 1;
    const updatedAt = new Date().toISOString();
    const failedJob: Record<string, unknown> = {
      ...job,
      state: "failed",
      stateRevision,
      updatedAt,
      activeOutputFormat: "png",
      error: {
        code: "E_IMAGE_OUTPUT_TOO_LARGE",
        stage: "export",
        message: "The image canvas would exceed the safe browser limit.",
        userMessageKey: "errors.imageOutputTooLarge",
        retryable: true,
        fallbackAllowed: true,
        causeCode: "ImageCanvasDimensionGuard",
      },
    };
    delete failedJob.outputArtifactId;
    delete failedJob.output;
    delete failedJob.exportProgress;

    jobs.put(failedJob);
    if (outputArtifactId !== undefined) artifacts.delete(outputArtifactId);
    await completed;
    database.close();

    const storageKey = "webcap.jobs.session";
    const stored = await chrome.storage.session.get(storageKey);
    const session = stored[storageKey] as
      | {
          schemaVersion: number;
          summaries: Array<Record<string, unknown>>;
          locks: unknown[];
        }
      | undefined;
    if (session === undefined) throw new Error("The job session metadata could not be resolved.");
    await chrome.storage.session.set({
      [storageKey]: {
        ...session,
        summaries: session.summaries.map((summary) =>
          summary.jobId === id
            ? {
                ...summary,
                state: "failed",
                stateRevision,
                updatedAt,
                errorCode: "E_IMAGE_OUTPUT_TOO_LARGE",
                errorUserMessageKey: "errors.imageOutputTooLarge",
              }
            : summary,
        ),
      },
    });
  }, jobId);
}

test("@smoke converts an oversized region image to PDF without recapture", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  test.setTimeout(90_000);
  await targetPage.goto("http://127.0.0.1:4174/region-selection.html");
  const tabId = await resolveTab(serviceWorker, targetPage);
  await startRegionSelection(await openPopup(), targetPage);

  const root = targetPage.locator("[data-webcap-region-selector]");
  await targetPage.keyboard.press("Space");
  const confirm = root.getByRole("button", { name: "Chụp vùng" });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(root).toHaveCount(0);

  const image = await waitForRegionState(serviceWorker, "completed");
  expect(image.job).toMatchObject({
    state: "completed",
    activeOutputFormat: "png",
    outputArtifactId: expect.any(String),
    output: {
      artifactId: expect.any(String),
      format: "png",
      mimeType: "image/png",
      byteLength: expect.any(Number),
    },
  });
  expect(image.tiles.length).toBeGreaterThan(0);
  expect(image.tiles.every((tile) => tile.blobSize > 0)).toBe(true);
  expect(image.outputArtifacts).toHaveLength(1);
  const jobId = image.job?.id;
  if (jobId === undefined) throw new Error("The completed region job could not be resolved.");
  const sourceTiles = structuredClone(image.tiles);
  const completedTiles = image.job?.completedTiles;
  const totalTiles = image.job?.totalTiles;

  await forceOversizedImageFailure(serviceWorker, jobId);
  const failed = await waitForRegionState(serviceWorker, "failed");
  expect(failed.job).toMatchObject({
    id: jobId,
    state: "failed",
    activeOutputFormat: "png",
    errorCode: "E_IMAGE_OUTPUT_TOO_LARGE",
    errorFallbackAllowed: true,
    errorCause: "ImageCanvasDimensionGuard",
    completedTiles,
    totalTiles,
  });
  expect(failed.job?.outputArtifactId).toBeUndefined();
  expect(failed.job?.output).toBeUndefined();
  expect(failed.tiles).toEqual(sourceTiles);
  expect(failed.outputArtifacts).toEqual([]);

  await targetPage.bringToFront();
  await serviceWorker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
  const fallbackPopup = await openPopup();
  const fallback = fallbackPopup.getByRole("button", {
    name: "Chuyển sang PDF không chụp lại",
  });
  await expect(fallback).toBeVisible({ timeout: 15_000 });
  await fallback.click();

  const pdf = await waitForRegionState(serviceWorker, "completed");
  expect(pdf.job).toMatchObject({
    id: jobId,
    state: "completed",
    activeOutputFormat: "pdf",
    outputArtifactId: expect.any(String),
    output: {
      artifactId: expect.any(String),
      format: "pdf",
      mimeType: "application/pdf",
      byteLength: expect.any(Number),
      pageCount: expect.any(Number),
    },
    completedTiles,
    totalTiles,
  });
  expect(pdf.job?.outputArtifactId).toBe(pdf.job?.output?.artifactId);
  expect(pdf.job?.output?.byteLength ?? 0).toBeGreaterThan(0);
  expect(pdf.job?.output?.pageCount ?? 0).toBeGreaterThan(0);
  expect(pdf.tiles).toEqual(sourceTiles);
  expect(pdf.outputArtifacts).toHaveLength(1);
  expect(pdf.outputArtifacts[0]).toMatchObject({
    artifactId: pdf.job?.outputArtifactId,
    format: "pdf",
    mimeType: "application/pdf",
    byteLength: pdf.job?.output?.byteLength,
    pageCount: pdf.job?.output?.pageCount,
  });
  const result = fallbackPopup.getByTestId("tiled-output-result");
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result).toHaveAttribute("data-format", "pdf");
  await expect(targetPage.locator("[data-webcap-region-selector]")).toHaveCount(0);
});
