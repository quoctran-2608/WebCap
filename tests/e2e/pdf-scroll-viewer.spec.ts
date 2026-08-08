import { PDFDocument } from "pdf-lib";
import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface PdfViewerState {
  job: {
    state: string;
    completedTiles: number;
    totalTiles: number;
    partialCaptureReason?: string;
    documentPageMap?: {
      strategy: string;
      complete: boolean;
      sourcePageCount: number;
      pages: Array<{
        index: number;
        sourceRectCss: { x: number; y: number; width: number; height: number };
      }>;
    };
    output?: {
      artifactId: string;
      format: string;
      mimeType: string;
      pageCount?: number;
      byteLength: number;
    };
  } | null;
  outputReference?: string;
  pdfBytes: number[];
}

async function startScrollAreaSelection(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: /^Vùng cuộn/ }).click();
  await expect(popup.getByRole("heading", { name: "Chụp toàn bộ vùng cuộn" })).toBeVisible();
  await popup.getByRole("button", { name: "Bắt đầu chọn vùng cuộn" }).click();
}

async function selectScrollableViewer(targetPage: Page): Promise<void> {
  const target = targetPage.locator("#pdf-scroll");
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("The PDF viewer fixture is not visible.");
  const root = targetPage.locator("[data-webcap-element-selector]");
  await targetPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await targetPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(root).toBeVisible();
  await targetPage.keyboard.press("Enter");
  await expect(root).toHaveCount(0);
}

async function readPdfViewerState(serviceWorker: Worker): Promise<PdfViewerState> {
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

    const jobTransaction = database.transaction("jobs", "readonly");
    const jobValues = await read<unknown[]>(jobTransaction.objectStore("jobs").getAll());
    const jobs = jobValues as Array<{
      mode: string;
      state: string;
      completedTiles: number;
      totalTiles: number;
      partialCapture?: { reason: string };
      documentPageMap?: {
        strategy: string;
        complete: boolean;
        sourcePageCount: number;
        pages: Array<{
          index: number;
          sourceRectCss: { x: number; y: number; width: number; height: number };
        }>;
      };
      outputArtifactId?: string;
      output?: {
        artifactId: string;
        format: string;
        mimeType: string;
        pageCount?: number;
        byteLength: number;
      };
      updatedAt: string;
    }>;
    const job = jobs
      .filter((candidate) => candidate.mode === "scroll-area")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    let outputReference: string | undefined;
    let pdfBytes: number[] = [];
    if (job?.outputArtifactId !== undefined) {
      const artifactTransaction = database.transaction("artifacts", "readonly");
      const artifact = (await read<unknown>(
        artifactTransaction.objectStore("artifacts").get(job.outputArtifactId),
      )) as { blob?: Blob; opfsReference?: string } | undefined;
      let blob = artifact?.blob;
      if (blob === undefined && artifact?.opfsReference !== undefined) {
        outputReference = artifact.opfsReference;
        const prefix = "webcap-pdf-output/";
        if (!artifact.opfsReference.startsWith(prefix)) {
          throw new Error("Unexpected PDF output spool reference.");
        }
        const fileName = artifact.opfsReference.slice(prefix.length);
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle("webcap-pdf-output");
        const handle = await directory.getFileHandle(fileName);
        blob = await handle.getFile();
      }
      if (blob !== undefined) {
        pdfBytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      }
    }
    database.close();

    return {
      job:
        job === undefined
          ? null
          : {
              state: job.state,
              completedTiles: job.completedTiles,
              totalTiles: job.totalTiles,
              ...(job.partialCapture === undefined
                ? {}
                : { partialCaptureReason: job.partialCapture.reason }),
              ...(job.documentPageMap === undefined
                ? {}
                : { documentPageMap: job.documentPageMap }),
              ...(job.output === undefined ? {} : { output: job.output }),
            },
      ...(outputReference === undefined ? {} : { outputReference }),
      pdfBytes,
    };
  });
}

test("@smoke exports one PDF page per detected viewer page with source orientation", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/pdf-scroll-viewer.html");
  const popup = await openPopup();
  await startScrollAreaSelection(popup);
  await targetPage.bringToFront();
  await selectScrollableViewer(targetPage);

  await expect
    .poll(async () => (await readPdfViewerState(serviceWorker)).job?.state ?? "missing", {
      timeout: 75_000,
    })
    .toBe("completed");

  const state = await readPdfViewerState(serviceWorker);
  expect(state.job).toMatchObject({
    state: "completed",
    completedTiles: expect.any(Number),
    totalTiles: expect.any(Number),
    documentPageMap: {
      strategy: "dom",
      complete: true,
      sourcePageCount: 3,
      pages: [
        { index: 0, sourceRectCss: { width: 640, height: 860 } },
        { index: 1, sourceRectCss: { width: 700, height: 500 } },
        { index: 2, sourceRectCss: { width: 640, height: 860 } },
      ],
    },
    output: {
      artifactId: expect.any(String),
      format: "pdf",
      mimeType: "application/pdf",
      pageCount: 3,
      byteLength: expect.any(Number),
    },
  });
  expect(state.job?.completedTiles).toBe(state.job?.totalTiles);
  expect(state.job?.completedTiles ?? 0).toBeGreaterThan(1);
  expect(state.job?.partialCaptureReason).toBeUndefined();
  expect(state.outputReference).toMatch(/^webcap-pdf-output\/.+\.pdf$/u);
  expect(state.pdfBytes.length).toBeGreaterThan(4);
  expect(String.fromCharCode(...state.pdfBytes.slice(0, 5))).toBe("%PDF-");

  const document = await PDFDocument.load(Uint8Array.from(state.pdfBytes));
  expect(document.getPageCount()).toBe(3);
  const [first, second, third] = document.getPages();
  expect(first?.getHeight()).toBeGreaterThan(first?.getWidth() ?? 0);
  expect(second?.getWidth()).toBeGreaterThan(second?.getHeight() ?? 0);
  expect(third?.getHeight()).toBeGreaterThan(third?.getWidth() ?? 0);
});
