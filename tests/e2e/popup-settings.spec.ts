import type { Page, Worker } from "@playwright/test";

import { expect, test } from "./extension.fixture";

interface StoredSettingsState {
  capture:
    | {
        settings?: {
          imageQuality?: number;
          fixedElementMode?: string;
          pdf?: {
            pageSize?: string;
            orientation?: string;
            marginMm?: number;
            jpegQuality?: number;
          };
        };
      }
    | undefined;
  popup:
    | {
        outputByMode?: Record<string, string>;
      }
    | undefined;
}

interface StoredJobState {
  id: string;
  state: string;
  outputArtifactId?: string;
  settings: {
    imageQuality: number;
    fixedElementMode: string;
    pdf: {
      pageSize: string;
      orientation: string;
      marginMm: number;
      jpegQuality: number;
    };
  };
}

async function openAdvancedSettings(popup: Page): Promise<void> {
  const details = popup.getByTestId("advanced-settings");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
}

async function readStoredSettings(serviceWorker: Worker): Promise<StoredSettingsState> {
  return serviceWorker.evaluate(async () => {
    const stored = await chrome.storage.local.get(["webcap.settings", "webcap.popup-preferences"]);
    return {
      capture: stored["webcap.settings"] as StoredSettingsState["capture"],
      popup: stored["webcap.popup-preferences"] as StoredSettingsState["popup"],
    };
  });
}

async function readLatestFullPageJob(serviceWorker: Worker): Promise<StoredJobState | null> {
  return serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("webcap-db", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open WebCap database."));
    });
    const transaction = database.transaction("jobs", "readonly");
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore("jobs").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to read WebCap jobs."));
    });
    database.close();
    const job = (
      values as Array<{
        id: string;
        mode: string;
        state: string;
        updatedAt: string;
        outputArtifactId?: string;
        settings: StoredJobState["settings"];
      }>
    )
      .filter((candidate) => candidate.mode === "full-page")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return job === undefined
      ? null
      : {
          id: job.id,
          state: job.state,
          ...(job.outputArtifactId === undefined ? {} : { outputArtifactId: job.outputArtifactId }),
          settings: job.settings,
        };
  });
}

test("@smoke persists advanced options, snapshots them into a job, and resets options only", async ({
  serviceWorker,
  targetPage,
  openPopup,
}) => {
  await targetPage.goto("http://127.0.0.1:4174/full-page-long.html");
  let popup = await openPopup();
  const advanced = popup.getByTestId("advanced-settings");
  await expect(advanced).not.toHaveAttribute("open", "");

  await popup.getByLabel("Định dạng đầu ra").selectOption("webp");
  await openAdvancedSettings(popup);
  await popup.getByTestId("image-quality").fill("73");
  await popup.getByTestId("fixed-element-mode").selectOption("remove");
  await popup.getByTestId("pdf-page-size").selectOption("letter");
  await popup.getByTestId("pdf-orientation").selectOption("landscape");
  await popup.getByTestId("pdf-margin").fill("12");
  await popup.getByTestId("pdf-quality").fill("81");
  await popup.getByTestId("save-settings").click();
  await expect(popup.getByText("Đã lưu tùy chọn cho các lượt chụp mới.")).toBeVisible();

  await expect
    .poll(async () => readStoredSettings(serviceWorker))
    .toMatchObject({
      capture: {
        settings: {
          imageQuality: 0.73,
          fixedElementMode: "remove",
          pdf: {
            pageSize: "letter",
            orientation: "landscape",
            marginMm: 12,
            jpegQuality: 0.81,
          },
        },
      },
      popup: { outputByMode: { visible: "webp" } },
    });

  await popup.close();
  popup = await openPopup();
  await expect(popup.getByLabel("Định dạng đầu ra")).toHaveValue("webp");
  await openAdvancedSettings(popup);
  await expect(popup.getByTestId("image-quality")).toHaveValue("73");
  await expect(popup.getByTestId("fixed-element-mode")).toHaveValue("remove");
  await expect(popup.getByTestId("pdf-page-size")).toHaveValue("letter");
  await expect(popup.getByTestId("pdf-orientation")).toHaveValue("landscape");
  await expect(popup.getByTestId("pdf-margin")).toHaveValue("12");
  await expect(popup.getByTestId("pdf-quality")).toHaveValue("81");

  await popup.getByRole("button", { name: /^Toàn bộ trang/ }).click();
  await popup.getByRole("button", { name: "Bắt đầu chụp toàn trang" }).click();
  await expect(popup.getByTestId("tiled-output-result")).toBeVisible({ timeout: 45_000 });

  const completedJob = await readLatestFullPageJob(serviceWorker);
  expect(completedJob).toMatchObject({
    state: "completed",
    outputArtifactId: expect.any(String),
    settings: {
      imageQuality: 0.73,
      fixedElementMode: "remove",
      pdf: {
        pageSize: "letter",
        orientation: "landscape",
        marginMm: 12,
        jpegQuality: 0.81,
      },
    },
  });

  await openAdvancedSettings(popup);
  await popup.getByTestId("reset-settings").click();
  await expect(
    popup.getByText("Đã đặt lại tùy chọn mặc định. Dữ liệu chụp hiện tại không bị thay đổi."),
  ).toBeVisible();
  await expect(popup.getByTestId("image-quality")).toHaveValue("90");
  await expect(popup.getByTestId("fixed-element-mode")).toHaveValue("smart");
  await expect(popup.getByTestId("pdf-page-size")).toHaveValue("a4");
  await expect(popup.getByTestId("pdf-orientation")).toHaveValue("portrait");
  await expect(popup.getByTestId("pdf-margin")).toHaveValue("8");
  await expect(popup.getByTestId("pdf-quality")).toHaveValue("90");

  await popup.getByRole("button", { name: /^Vùng đang thấy/ }).click();
  await expect(popup.getByLabel("Định dạng đầu ra")).toHaveValue("png");

  const retainedJob = await readLatestFullPageJob(serviceWorker);
  expect(retainedJob?.id).toBe(completedJob?.id);
  expect(retainedJob?.outputArtifactId).toBe(completedJob?.outputArtifactId);
  expect(retainedJob?.state).toBe("completed");
  await expect(readStoredSettings(serviceWorker)).resolves.toMatchObject({
    capture: {
      settings: {
        imageQuality: 0.9,
        fixedElementMode: "smart",
        pdf: {
          pageSize: "a4",
          orientation: "portrait",
          marginMm: 8,
          jpegQuality: 0.9,
        },
      },
    },
    popup: { outputByMode: { visible: "png" } },
  });
});
