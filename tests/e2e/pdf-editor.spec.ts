import { readFile } from "node:fs/promises";

import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface EditorStorageState {
  tileCount: number;
  tileBytes: number;
  jobState: string;
  outputArtifactId: string | null;
  outputPageCount: number;
  manifestRevision: number;
  manifestPageIds: string[];
}

async function readEditorState(editor: Page, jobId: string): Promise<EditorStorageState> {
  return editor.evaluate(async (id) => {
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
    const [jobValue, tileValues, artifactValues] = await Promise.all([
      read<unknown>(transaction.objectStore("jobs").get(id)),
      read<unknown[]>(transaction.objectStore("tiles").getAll()),
      read<unknown[]>(transaction.objectStore("artifacts").getAll()),
    ]);
    const job = jobValue as {
      state: string;
      outputArtifactId?: string;
    };
    const tiles = (tileValues as Array<{ jobId: string; blob?: Blob }>).filter(
      (record) => record.jobId === id,
    );
    const artifact = (artifactValues as Array<{ artifactId: string; pageCount?: number }>).find(
      (candidate) =>
        job.outputArtifactId !== undefined && candidate.artifactId === job.outputArtifactId,
    );
    database.close();

    const key = `webcap.pdf-edit.${id}`;
    const stored = await chrome.storage.local.get(key);
    const manifest = stored[key] as { revision: number; pages: Array<{ id: string }> };
    return {
      tileCount: tiles.length,
      tileBytes: tiles.reduce((total, record) => total + (record.blob?.size ?? 0), 0),
      jobState: job.state,
      outputArtifactId: job.outputArtifactId ?? null,
      outputPageCount: artifact?.pageCount ?? 0,
      manifestRevision: manifest.revision,
      manifestPageIds: manifest.pages.map((page) => page.id),
    };
  }, jobId);
}

async function waitForPdfDownload(
  serviceWorker: Worker,
  downloadId: number,
): Promise<{ id: number; filename: string; state: string }> {
  await expect
    .poll(
      () =>
        serviceWorker.evaluate(async (id) => {
          const [item] = await chrome.downloads.search({ id });
          if (item?.state === "interrupted") {
            return `${item.state}:${item.error ?? "unknown"}`;
          }
          return item?.state ?? "missing";
        }, downloadId),
      { timeout: 30_000 },
    )
    .toBe("complete");

  return serviceWorker.evaluate(async (id) => {
    const [item] = await chrome.downloads.search({ id });
    if (item === undefined) throw new Error("PDF download was not found.");
    return { id: item.id, filename: item.filename, state: item.state };
  }, downloadId);
}

test("@smoke edits, restores, exports, and downloads PDF without recapture", async ({
  context,
  extensionId,
  openPopup,
  serviceWorker,
  targetPage,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/full-page-long.html");
  const popup = await openPopup();
  await popup.getByRole("button", { name: /^Toàn bộ trang/ }).click();
  await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();
  await expect(popup.getByText("Tile set toàn trang đã sẵn sàng.")).toBeVisible({
    timeout: 45_000,
  });

  const editorPromise = context.waitForEvent("page", {
    predicate: (page) => page.url().startsWith(`chrome-extension://${extensionId}/editor.html`),
  });
  await popup.getByRole("button", { name: "Mở trình biên tập PDF" }).click();
  const editor = await editorPromise;
  await editor.bringToFront();
  await editor.waitForLoadState("domcontentloaded");
  await expect(editor.getByRole("heading", { name: "Trình biên tập PDF" })).toBeVisible();

  const jobId = new URL(editor.url()).searchParams.get("jobId");
  if (jobId === null) throw new Error("PDF editor URL does not contain jobId.");
  const cards = editor.locator(".page-card");
  await expect.poll(() => cards.count()).toBeGreaterThan(2);
  const initialState = await readEditorState(editor, jobId);
  expect(initialState.tileCount).toBe(2);
  expect(initialState.tileBytes).toBeGreaterThan(0);

  const thumbnail = cards.first().locator("img");
  await expect(thumbnail).toBeVisible({ timeout: 30_000 });
  const thumbnailSize = await thumbnail.evaluate((image: HTMLImageElement) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
  expect(Math.max(thumbnailSize.width, thumbnailSize.height)).toBeLessThanOrEqual(320);

  await editor.getByLabel("Khổ giấy").selectOption("letter");
  await editor.getByLabel("Hướng giấy").selectOption("landscape");
  await editor.getByLabel(/Lề trang/).fill("12");
  await editor.getByLabel(/Chất lượng JPEG/).fill("0.75");
  await editor.getByRole("button", { name: "Áp dụng tùy chọn" }).click();
  await expect(editor.getByText("Đã áp dụng tùy chọn và tính lại danh sách trang.")).toBeVisible();
  await expect.poll(() => cards.count()).toBeGreaterThan(2);

  await cards.first().press("Alt+ArrowDown");
  await expect(cards.first()).toContainText("Nguồn #2");
  const countBeforeDelete = await cards.count();
  await cards.last().getByRole("button", { name: "Xóa" }).click();
  await expect(cards).toHaveCount(countBeforeDelete - 1);
  const editedCount = await cards.count();
  const sourceLabel = cards.first().getByText(/^Nguồn #\d+$/);
  const editedFirstSource = await sourceLabel.textContent();

  await editor.reload();
  await editor.bringToFront();
  await expect(editor.getByRole("heading", { name: "Trình biên tập PDF" })).toBeVisible();
  await expect(editor.locator(".page-card")).toHaveCount(editedCount);
  const restoredSourceLabel = editor
    .locator(".page-card")
    .first()
    .getByText(/^Nguồn #\d+$/);
  await expect(restoredSourceLabel).toHaveText(editedFirstSource ?? "Nguồn #2");
  const restored = await readEditorState(editor, jobId);
  expect(restored.manifestRevision).toBeGreaterThanOrEqual(3);
  expect(restored.manifestPageIds).toHaveLength(editedCount);
  expect(restored.tileCount).toBe(initialState.tileCount);
  expect(restored.tileBytes).toBe(initialState.tileBytes);

  await editor.getByRole("button", { name: "Tạo PDF" }).click();
  await expect(editor.getByRole("button", { name: "Tải PDF xuống" })).toBeVisible({
    timeout: 45_000,
  });

  const completed = await readEditorState(editor, jobId);
  expect(completed).toMatchObject({
    jobState: "completed",
    tileCount: initialState.tileCount,
    tileBytes: initialState.tileBytes,
    outputPageCount: editedCount,
  });
  expect(completed.outputArtifactId).toBeTruthy();

  await editor.getByRole("button", { name: "Tải PDF xuống" }).click();
  const downloadStatus = editor.getByTestId("download-status");
  await expect(downloadStatus).toHaveAttribute("data-download-id", /^\d+$/, {
    timeout: 30_000,
  });
  const downloadId = Number(await downloadStatus.getAttribute("data-download-id"));
  expect(Number.isInteger(downloadId)).toBe(true);
  const download = await waitForPdfDownload(serviceWorker, downloadId);
  expect(download.state).toBe("complete");
  const bytes = await readFile(download.filename);
  expect(bytes.byteLength).toBeGreaterThan(5);
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});
