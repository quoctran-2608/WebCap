import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function patchFile(path, patch) {
  const source = readFileSync(path, "utf8");
  writeFileSync(path, patch(source));
}

patchFile("src/background/persistent-job-router.ts", (source) =>
  replaceOnce(
    source,
    "      if (job.mode === \"scroll-area\" && dependencies.scrollAreaCaptures !== undefined) {",
    "      if (job.state === \"exporting\" && dependencies.completion !== undefined) {\n        return { kind: \"job\", job: await dependencies.completion.cancel(job.id) };\n      }\n      if (job.mode === \"scroll-area\" && dependencies.scrollAreaCaptures !== undefined) {",
    "route export cancellation through completion service",
  ),
);

patchFile("src/popup/full-page-client.ts", (source) => {
  source = replaceOnce(
    source,
    'import type { CaptureJob, ImageFormat } from "@shared/contracts/domain";',
    'import type { CaptureJob, CaptureSettings, ImageFormat } from "@shared/contracts/domain";',
    "full-page client settings import",
  );
  source = replaceOnce(
    source,
    "  createJobGetMessage,\n  isJobActiveResponseMessage,",
    "  createJobGetMessage,\n  createPdfExportStartMessage,\n  isJobActiveResponseMessage,",
    "full-page client PDF request import",
  );
  return replaceOnce(
    source,
    "export function getCaptureJob(jobId: string): Promise<CaptureJob> {\n  return sendJobRequest(\n    createJobGetMessage({\n      requestId: crypto.randomUUID(),\n      jobId,\n      sentAt: new Date().toISOString(),\n    }),\n  );\n}\n",
    "export function getCaptureJob(jobId: string): Promise<CaptureJob> {\n  return sendJobRequest(\n    createJobGetMessage({\n      requestId: crypto.randomUUID(),\n      jobId,\n      sentAt: new Date().toISOString(),\n    }),\n  );\n}\n\nexport function startPdfExport(\n  jobId: string,\n  settings?: CaptureSettings[\"pdf\"],\n): Promise<CaptureJob> {\n  return sendJobRequest(\n    createPdfExportStartMessage({\n      requestId: crypto.randomUUID(),\n      jobId,\n      ...(settings === undefined ? {} : { settings }),\n      sentAt: new Date().toISOString(),\n    }),\n  );\n}\n",
    "full-page client PDF export method",
  );
});

patchFile("src/popup/App.tsx", (source) => {
  source = replaceOnce(
    source,
    "  startRegionCapture,\n  startScrollAreaCapture,\n  stopFullPageCapture,",
    "  startRegionCapture,\n  startScrollAreaCapture,\n  startPdfExport,\n  stopFullPageCapture,",
    "popup PDF export import",
  );
  source = replaceOnce(
    source,
    "function tiledStatusCopy(locale: UiLocale, job: CaptureJob): string {\n  const specializedStates = [",
    "function tiledStatusCopy(locale: UiLocale, job: CaptureJob): string {\n  if (job.state === \"exporting\" && job.activeOutputFormat !== undefined && job.activeOutputFormat !== \"pdf\") {\n    return t(locale, \"popup.job.imageExporting\");\n  }\n  if (job.state === \"completed\" && job.output !== undefined && job.output.format !== \"pdf\") {\n    return t(locale, \"popup.job.imageCompleted\");\n  }\n  const specializedStates = [",
    "popup mode-aware job status",
  );
  source = replaceOnce(
    source,
    "  const [resetBusy, setResetBusy] = useState(false);\n  const [resetNotice, setResetNotice] = useState<string>();",
    "  const [resetBusy, setResetBusy] = useState(false);\n  const [resetNotice, setResetNotice] = useState<string>();\n  const [tiledDownloading, setTiledDownloading] = useState(false);\n  const [tiledDownloadId, setTiledDownloadId] = useState<number>();",
    "popup tiled download state",
  );
  source = replaceOnce(
    source,
    "  const busy = (tiledMode ? fullPageBusy : visibleBusy) || resetBusy;",
    "  const busy = (tiledMode ? fullPageBusy || tiledDownloading : visibleBusy) || resetBusy;",
    "popup tiled download busy state",
  );
  source = replaceOnce(
    source,
    "  const selectedModeEnabled = capabilities.modes[selectedMode];",
    "  const tiledOutputHint =\n    selectedMode === \"region\" || selectedMode === \"element\"\n      ? t(locale, \"popup.imageOutputHint\")\n      : t(locale, \"popup.pdfOutputHint\");\n  const selectedModeEnabled = capabilities.modes[selectedMode];",
    "popup mode-aware output hint",
  );
  source = replaceOnce(
    source,
    "      setPreviewUrl(undefined);\n      activeCaptureRequestIdRef.current = undefined;",
    "      setPreviewUrl(undefined);\n      setTiledDownloadId(undefined);\n      activeCaptureRequestIdRef.current = undefined;",
    "popup reset tiled download state",
  );
  source = replaceOnce(
    source,
    "  const handleOpenPdfEditor = useCallback(async (): Promise<void> => {",
    "  const handleTiledDownload = useCallback(async (): Promise<void> => {\n    const artifactId = fullPageJob?.output?.artifactId;\n    if (artifactId === undefined) return;\n    setTiledDownloading(true);\n    setTiledDownloadId(undefined);\n    setUiError(undefined);\n    try {\n      setTiledDownloadId(await downloadArtifact(artifactId));\n    } catch (error) {\n      setUiError(genericErrorCopy(locale, error));\n    } finally {\n      setTiledDownloading(false);\n    }\n  }, [fullPageJob?.output?.artifactId, locale]);\n\n  const handleStartPdfExport = useCallback(async (): Promise<void> => {\n    if (fullPageJob === undefined) return;\n    setUiError(undefined);\n    setTiledDownloadId(undefined);\n    try {\n      const job = await startPdfExport(fullPageJob.id, fullPageJob.settings.pdf);\n      setFullPageJob(job);\n      await syncFullPageJob(job.id);\n    } catch (error) {\n      setUiError(genericErrorCopy(locale, error));\n    }\n  }, [fullPageJob, locale, syncFullPageJob]);\n\n  const handleOpenPdfEditor = useCallback(async (): Promise<void> => {",
    "popup tiled output handlers",
  );
  source = replaceOnce(
    source,
    "          <p className=\"field-label\">{t(locale, \"popup.pdfOutputHint\")}</p>",
    "          <p className=\"field-label\">{tiledOutputHint}</p>",
    "popup mode-aware output hint rendering",
  );
  source = replaceOnce(
    source,
    "              <button\n                className=\"primary-action\"\n                type=\"button\"\n                onClick={() => void handleOpenPdfEditor()}\n              >\n                {t(locale, \"popup.openEditor\")}\n              </button>",
    "              <button\n                className=\"primary-action\"\n                type=\"button\"\n                onClick={() => void handleStartPdfExport()}\n              >\n                {fullPageJob.partialCapture === undefined\n                  ? t(locale, \"popup.exportPdf\")\n                  : t(locale, \"popup.exportPartialPdf\")}\n              </button>\n              <button\n                className=\"secondary-action\"\n                type=\"button\"\n                onClick={() => void handleOpenPdfEditor()}\n              >\n                {t(locale, \"popup.openEditor\")}\n              </button>",
    "popup ready explicit PDF export",
  );
  const completedOld = `          {tiledMode && fullPageJob?.state === "completed" && (\n            <div className="feedback feedback--success">\n              <h3 ref={feedbackHeadingRef} tabIndex={-1}>\n                {t(locale, "popup.pdfReady")}\n              </h3>\n              <p>{t(locale, "popup.pdfReadyDetail")}</p>\n              <button\n                className="primary-action"\n                type="button"\n                onClick={() => void handleOpenPdfEditor()}\n              >\n                {t(locale, "popup.openDownloadPdf")}\n              </button>\n              <button\n                className="secondary-action"\n                type="button"\n                disabled={resetBusy}\n                onClick={() => void handleNewCapture()}\n              >\n                {resetBusy ? t(locale, "popup.reset.running") : t(locale, "common.newCapture")}\n              </button>\n            </div>\n          )}`;
  const completedNew = `          {tiledMode && fullPageJob?.state === "completed" && fullPageJob.output !== undefined && (\n            <div\n              className="feedback feedback--success"\n              data-testid="tiled-output-result"\n              data-artifact-id={fullPageJob.output.artifactId}\n              data-format={fullPageJob.output.format}\n            >\n              <h3 ref={feedbackHeadingRef} tabIndex={-1}>\n                {fullPageJob.output.format === "pdf"\n                  ? t(locale, "popup.output.pdfReady")\n                  : t(locale, "popup.output.imageReady")}\n              </h3>\n              <p>\n                {t(locale, "popup.output.detail", {\n                  format: fullPageJob.output.format.toUpperCase(),\n                  bytes: formatBytes(fullPageJob.output.byteLength),\n                })}\n              </p>\n              {fullPageJob.output.pageCount !== undefined && (\n                <p>{t(locale, "popup.output.pages", { count: fullPageJob.output.pageCount })}</p>\n              )}\n              <button\n                className="primary-action"\n                type="button"\n                disabled={tiledDownloading}\n                onClick={() => void handleTiledDownload()}\n              >\n                {tiledDownloading\n                  ? t(locale, "popup.output.downloading")\n                  : t(locale, "common.download")}\n              </button>\n              {fullPageJob.output.format === "pdf" && (\n                <button\n                  className="secondary-action"\n                  type="button"\n                  onClick={() => void handleOpenPdfEditor()}\n                >\n                  {t(locale, "popup.output.editPdf")}\n                </button>\n              )}\n              <button\n                className="secondary-action"\n                type="button"\n                disabled={resetBusy}\n                onClick={() => void handleNewCapture()}\n              >\n                {resetBusy ? t(locale, "popup.reset.running") : t(locale, "common.newCapture")}\n              </button>\n              {tiledDownloadId !== undefined && (\n                <p\n                  data-testid="tiled-download-success"\n                  data-download-id={tiledDownloadId}\n                >\n                  {t(locale, "popup.output.downloadStarted")}\n                </p>\n              )}\n            </div>\n          )}`;
  source = replaceOnce(source, completedOld, completedNew, "popup mode-aware completed result");
  source = replaceOnce(
    source,
    "                onClick={() =>\n                  fullPageJob.totalTiles > 0 &&\n                  fullPageJob.completedTiles === fullPageJob.totalTiles\n                    ? void handleOpenPdfEditor()\n                    : void handleRetry()\n                }",
    "                onClick={() =>\n                  fullPageJob.error?.code === \"E_IMAGE_OUTPUT_TOO_LARGE\"\n                    ? void handleStartPdfExport()\n                    : fullPageJob.totalTiles > 0 &&\n                        fullPageJob.completedTiles === fullPageJob.totalTiles\n                      ? void handleOpenPdfEditor()\n                      : void handleRetry()\n                }",
    "popup PDF fallback action",
  );
  source = replaceOnce(
    source,
    "                {fullPageJob.totalTiles > 0 && fullPageJob.completedTiles === fullPageJob.totalTiles\n                  ? t(locale, \"popup.retryExport\")",
    "                {fullPageJob.error?.code === \"E_IMAGE_OUTPUT_TOO_LARGE\"\n                  ? t(locale, \"popup.exportPdfFallback\")\n                  : fullPageJob.totalTiles > 0 &&\n                      fullPageJob.completedTiles === fullPageJob.totalTiles\n                    ? t(locale, \"popup.retryExport\")",
    "popup PDF fallback label",
  );
  return source;
});

patchFile("src/shared/i18n.ts", (source) => {
  source = replaceOnce(
    source,
    '  "popup.pdfOutputHint":\n    "Đầu ra: PDF nhiều trang · chỉnh khổ giấy, lề, chất lượng và thứ tự sau khi chụp.",',
    '  "popup.pdfOutputHint":\n    "Đầu ra mặc định: PDF nhiều trang, tự tạo ngay sau khi chụp.",\n  "popup.imageOutputHint":\n    "Đầu ra mặc định: ảnh đã chọn; WebCap sẽ đề nghị PDF nếu ảnh vượt giới hạn canvas an toàn.",',
    "Vietnamese output hints",
  );
  source = replaceOnce(
    source,
    '  "popup.job.exporting": "Đang tạo PDF từng trang…",\n  "popup.job.completed": "PDF đã sẵn sàng để tải xuống.",',
    '  "popup.job.exporting": "Đang tạo PDF từng trang…",\n  "popup.job.completed": "PDF đã sẵn sàng để tải xuống.",\n  "popup.job.imageExporting": "Đang ghép ảnh từ các tile đã lưu…",\n  "popup.job.imageCompleted": "Ảnh đã sẵn sàng để tải xuống.",',
    "Vietnamese mode-aware job status",
  );
  source = replaceOnce(
    source,
    '  "popup.openDownloadPdf": "Mở và tải PDF",',
    '  "popup.openDownloadPdf": "Mở và tải PDF",\n  "popup.exportPdf": "Tạo PDF từ tile đã lưu",\n  "popup.exportPartialPdf": "Tạo PDF từ phần đã giữ",\n  "popup.exportPdfFallback": "Chuyển sang PDF không chụp lại",\n  "popup.output.pdfReady": "PDF đã sẵn sàng",\n  "popup.output.imageReady": "Ảnh đã sẵn sàng",\n  "popup.output.detail": "{format} · {bytes}",\n  "popup.output.pages": "{count} trang PDF",\n  "popup.output.downloading": "Đang gửi tới Chrome Downloads…",\n  "popup.output.downloadStarted": "Tệp đã được gửi tới Chrome Downloads.",\n  "popup.output.editPdf": "Mở trình biên tập PDF",',
    "Vietnamese output actions",
  );
  source = replaceOnce(
    source,
    '  "popup.pdfOutputHint":\n    "Output: multi-page PDF · adjust paper, margins, quality, and order after capture.",',
    '  "popup.pdfOutputHint": "Default output: a multi-page PDF created automatically after capture.",\n  "popup.imageOutputHint":\n    "Default output: the selected image format; WebCap offers PDF when a safe browser canvas would be exceeded.",',
    "English output hints",
  );
  source = replaceOnce(
    source,
    '  "popup.job.exporting": "Creating PDF pages…",\n  "popup.job.completed": "The PDF is ready to download.",',
    '  "popup.job.exporting": "Creating PDF pages…",\n  "popup.job.completed": "The PDF is ready to download.",\n  "popup.job.imageExporting": "Composing an image from stored tiles…",\n  "popup.job.imageCompleted": "The image is ready to download.",',
    "English mode-aware job status",
  );
  return replaceOnce(
    source,
    '  "popup.openDownloadPdf": "Open and download PDF",',
    '  "popup.openDownloadPdf": "Open and download PDF",\n  "popup.exportPdf": "Create PDF from stored tiles",\n  "popup.exportPartialPdf": "Create PDF from retained content",\n  "popup.exportPdfFallback": "Switch to PDF without recapturing",\n  "popup.output.pdfReady": "PDF is ready",\n  "popup.output.imageReady": "Image is ready",\n  "popup.output.detail": "{format} · {bytes}",\n  "popup.output.pages": "{count} PDF pages",\n  "popup.output.downloading": "Sending to Chrome Downloads…",\n  "popup.output.downloadStarted": "The file was sent to Chrome Downloads.",\n  "popup.output.editPdf": "Open PDF editor",',
    "English output actions",
  );
});

patchFile("tests/unit/persistent-job-router.test.ts", (source) =>
  replaceOnce(
    source,
    '  it("caches normalized errors for duplicate missing-job reads", async () => {',
    '  it("routes export cancellation through the completion service", async () => {\n    const jobs = new FakeCoordinator();\n    const dedupe = new MemoryDedupe();\n    const exporting = {\n      ...job(),\n      state: "exporting" as const,\n      stateRevision: 4,\n      activeOutputFormat: "pdf" as const,\n      exportProgress: { completedPages: 1, totalPages: 3 },\n    };\n    jobs.current = exporting;\n    const captureCancel = vi.fn(() => Promise.resolve(exporting));\n    const completionCancel = vi.fn(() =>\n      Promise.resolve({ ...exporting, state: "ready" as const, stateRevision: 5 }),\n    );\n    const completion = {\n      startAuto: vi.fn(() => Promise.resolve(exporting)),\n      recoverAll: vi.fn(() => Promise.resolve([])),\n      cancel: completionCancel,\n      waitForIdle: vi.fn(() => Promise.resolve()),\n    };\n    const message = createJobCancelMessage({\n      requestId: "request-cancel-export",\n      sentAt: now.toISOString(),\n      jobId: exporting.id,\n      reason: "stop export",\n    });\n\n    const response = await routePersistentJobMessage(\n      message,\n      dependencies(\n        jobs,\n        dedupe,\n        { start: () => Promise.resolve(), cancel: captureCancel },\n        completion,\n      ),\n    );\n\n    expect(completionCancel).toHaveBeenCalledWith(exporting.id);\n    expect(captureCancel).not.toHaveBeenCalled();\n    expect(response).toMatchObject({\n      type: "JOB_RESPONSE",\n      payload: { job: { state: "ready" } },\n    });\n  });\n\n  it("caches normalized errors for duplicate missing-job reads", async () => {',
    "router export cancellation test",
  ),
);

const files = [
  "src/background/persistent-job-router.ts",
  "src/popup/full-page-client.ts",
  "src/popup/App.tsx",
  "src/shared/i18n.ts",
  "tests/unit/persistent-job-router.test.ts",
];
const prettier = spawnSync("pnpm", ["exec", "prettier", "--write", ...files], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
process.stdout.write(prettier.stdout ?? "");
process.stderr.write(prettier.stderr ?? "");
if (prettier.status !== 0) process.exit(prettier.status ?? 1);

for (const file of files) {
  const destination = `artifacts/s24-popup/${file}`;
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(file, destination);
}
writeFileSync(
  "artifacts/s24-popup/manifest.json",
  `${JSON.stringify({ files }, null, 2)}\n`,
);
process.exit(1);
