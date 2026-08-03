import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface PdfState {
  job: {
    id: string;
    state: string;
    outputArtifactId: string | null;
    completedPages: number;
    totalPages: number;
    tileCount: number;
    errorCode?: string;
  } | null;
  artifact: {
    artifactId: string;
    format: string;
    mimeType: string;
    pageCount: number;
    byteLength: number;
    blobSize: number;
    signature: string;
  } | null;
}

async function selectFullPage(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Toàn bộ trang/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp toàn bộ trang" })).toBeVisible();
}

async function readPdfState(serviceWorker: Worker): Promise<PdfState> {
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
      updatedAt: string;
      outputArtifactId?: string;
      exportProgress?: { completedPages: number; totalPages: number };
      error?: { code: string };
    }>;
    const job = jobs
      .filter((candidate) => candidate.mode === "full-page")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const tiles = (tileValues as Array<{ jobId: string }>).filter(
      (record) => job !== undefined && record.jobId === job.id,
    );
    const artifact = (
      artifactValues as Array<{
        artifactId: string;
        format: string;
        mimeType: string;
        pageCount?: number;
        byteLength: number;
        blob?: Blob;
      }>
    ).find(
      (candidate) =>
        job?.outputArtifactId !== undefined && candidate.artifactId === job.outputArtifactId,
    );
    let signature = "";
    if (artifact?.blob !== undefined) {
      const bytes = new Uint8Array(await artifact.blob.slice(0, 5).arrayBuffer());
      signature = String.fromCharCode(...bytes);
    }
    database.close();
    return {
      job:
        job === undefined
          ? null
          : {
              id: job.id,
              state: job.state,
              outputArtifactId: job.outputArtifactId ?? null,
              completedPages: job.exportProgress?.completedPages ?? 0,
              totalPages: job.exportProgress?.totalPages ?? 0,
              tileCount: tiles.length,
              ...(job.error === undefined ? {} : { errorCode: job.error.code }),
            },
      artifact:
        artifact === undefined
          ? null
          : {
              artifactId: artifact.artifactId,
              format: artifact.format,
              mimeType: artifact.mimeType,
              pageCount: artifact.pageCount ?? 0,
              byteLength: artifact.byteLength,
              blobSize: artifact.blob?.size ?? 0,
              signature,
            },
    };
  });
}

test("@smoke exports a stored full-page tile set as a loadable paged PDF", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/full-page-long.html");
  const popup = await openPopup();
  await selectFullPage(popup);
  await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();
  await expect(popup.getByText("Tile set toàn trang đã sẵn sàng.")).toBeVisible({
    timeout: 45_000,
  });

  const ready = await readPdfState(serviceWorker);
  expect(ready.job).toMatchObject({ state: "ready", tileCount: 2 });
  const jobId = ready.job?.id;
  if (jobId === undefined) throw new Error("The ready full-page job could not be resolved.");

  const response = await popup.evaluate(async (id) => {
    return chrome.runtime.sendMessage({
      protocolVersion: 1,
      requestId: crypto.randomUUID(),
      source: "popup",
      target: "background",
      type: "PDF_EXPORT_START",
      payload: {
        jobId: id,
        settings: {
          pageSize: "a4",
          orientation: "portrait",
          marginMm: 8,
          jpegQuality: 0.82,
        },
      },
      sentAt: new Date().toISOString(),
    });
  }, jobId);
  expect(response).toMatchObject({
    type: "JOB_RESPONSE",
    payload: {
      job: {
        id: jobId,
        state: "exporting",
        exportProgress: { completedPages: 0 },
      },
    },
  });

  await expect
    .poll(
      async () => {
        const state = await readPdfState(serviceWorker);
        return state.job?.state ?? "missing";
      },
      { timeout: 45_000 },
    )
    .toBe("completed");

  const completed = await readPdfState(serviceWorker);
  expect(completed.job).toMatchObject({
    state: "completed",
    tileCount: 2,
  });
  expect(completed.job?.totalPages ?? 0).toBeGreaterThan(1);
  expect(completed.job?.completedPages).toBe(completed.job?.totalPages);
  expect(completed.artifact).toMatchObject({
    artifactId: completed.job?.outputArtifactId,
    format: "pdf",
    mimeType: "application/pdf",
    pageCount: completed.job?.totalPages,
    signature: "%PDF-",
  });
  expect(completed.artifact?.byteLength ?? 0).toBeGreaterThan(0);
  expect(completed.artifact?.blobSize).toBe(completed.artifact?.byteLength);
});
