import { readFile, writeFile } from "node:fs/promises";

async function replaceExact(path, replacements) {
  let content = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (!content.includes(before)) {
      throw new Error(`Expected popup integration text was not found in ${path}: ${before.slice(0, 80)}`);
    }
    content = content.replace(before, after);
  }
  await writeFile(path, content);
}

await replaceExact("src/shared/capabilities.ts", [["    pdf: false,", "    pdf: true,"]]);

await replaceExact("src/popup/App.tsx", [
  [
    '["created", "preparing", "capturing", "processing", "cancelling"].includes(job.state)',
    '["created", "preparing", "capturing", "processing", "exporting", "cancelling"].includes(\n      job.state,\n    )',
  ],
  [
    '["ready", "failed", "cancelled"].includes(fullPageJob.state)',
    '["ready", "exporting", "completed", "failed", "cancelled"].includes(fullPageJob.state)',
  ],
  ['  ready: "Tile set toàn trang đã sẵn sàng.",', '  ready: "Tile set đã sẵn sàng để biên tập PDF.",'],
  ['  exporting: "Đang xuất kết quả…",', '  exporting: "Đang tạo PDF từng trang…",'],
  ['  completed: "Đã hoàn tất.",', '  completed: "PDF đã sẵn sàng để tải xuống.",'],
  [
    '          <span className="planned-badge">\n            {selectedMode === "element" ? "S12" : selectedMode === "region" ? "S11" : "S10"}\n          </span>',
    '          <span className="planned-badge">{selectedMode === "visible" ? "M1" : "S14"}</span>',
  ],
  [
    '        <label className="field-label" htmlFor="output-format">\n          Định dạng đầu ra\n        </label>\n        <select\n          id="output-format"\n          aria-label="Định dạng đầu ra"\n          value={selectedFormat}\n          disabled={busy}\n          onChange={(event) => setSelectedFormat(event.target.value as ImageFormat)}\n        >\n          {availableFormats.map((format) => (\n            <option value={format.id} key={format.id}>\n              {format.label}\n            </option>\n          ))}\n        </select>',
    '        {selectedMode === "visible" ? (\n          <>\n            <label className="field-label" htmlFor="output-format">\n              Định dạng đầu ra\n            </label>\n            <select\n              id="output-format"\n              aria-label="Định dạng đầu ra"\n              value={selectedFormat}\n              disabled={busy}\n              onChange={(event) => setSelectedFormat(event.target.value as ImageFormat)}\n            >\n              {availableFormats.map((format) => (\n                <option value={format.id} key={format.id}>\n                  {format.label}\n                </option>\n              ))}\n            </select>\n          </>\n        ) : (\n          <p className="field-label">Đầu ra: PDF nhiều trang · chỉnh khổ giấy, lề, chất lượng và thứ tự sau khi chụp.</p>\n        )}',
  ],
  [
    '            disabled={!canCapture || fullPageJob?.state === "ready"}',
    '            disabled={\n              !canCapture || fullPageJob?.state === "ready" || fullPageJob?.state === "completed"\n            }',
  ],
  [
    '  const sourceEstimate =\n',
    '  const handleOpenPdfEditor = useCallback(async (): Promise<void> => {\n    if (fullPageJob === undefined) return;\n    await chrome.tabs.create({\n      url: chrome.runtime.getURL(\n        `editor.html?jobId=${encodeURIComponent(fullPageJob.id)}`,\n      ),\n    });\n    window.close();\n  }, [fullPageJob]);\n\n  const sourceEstimate =\n',
  ],
  [
    '              <p>\n                {fullPageJob.completedTiles} tile PNG đang được giữ cục bộ trong IndexedDB. Ghép ảnh\n                và export cuối thuộc milestone xuất kết quả sau S12.\n              </p>\n              <button className="text-action" type="button" onClick={() => void handleCancel()}>\n                Kết thúc phiên tile\n              </button>',
    '              <p>\n                {fullPageJob.completedTiles} source tile đang được giữ cục bộ. Mở editor để xem\n                thumbnail, đổi khổ giấy, sắp xếp hoặc bỏ trang và tạo PDF mà không chụp lại.\n              </p>\n              <button\n                className="primary-action"\n                type="button"\n                onClick={() => void handleOpenPdfEditor()}\n              >\n                Mở trình biên tập PDF\n              </button>',
  ],
  [
    '          {tiledMode && fullPageJob?.state === "cancelled" && (',
    '          {tiledMode && fullPageJob?.state === "completed" && (\n            <div className="feedback feedback--success">\n              <h3 ref={feedbackHeadingRef} tabIndex={-1}>PDF đã sẵn sàng</h3>\n              <p>Mở editor để tải file PDF đã tạo.</p>\n              <button\n                className="primary-action"\n                type="button"\n                onClick={() => void handleOpenPdfEditor()}\n              >\n                Mở và tải PDF\n              </button>\n            </div>\n          )}\n          {tiledMode && fullPageJob?.state === "cancelled" && (',
  ],
  [
    '              <button className="text-action" type="button" onClick={() => void handleRetry()}>\n                {selectedMode === "region"\n                  ? "Chọn lại vùng"\n                  : selectedMode === "element"\n                    ? "Chọn lại phần tử"\n                    : "Thử lại chụp toàn trang"}\n              </button>',
    '              <button\n                className="text-action"\n                type="button"\n                onClick={() =>\n                  fullPageJob.totalTiles > 0 &&\n                  fullPageJob.completedTiles === fullPageJob.totalTiles\n                    ? void handleOpenPdfEditor()\n                    : void handleRetry()\n                }\n              >\n                {fullPageJob.totalTiles > 0 &&\n                fullPageJob.completedTiles === fullPageJob.totalTiles\n                  ? "Mở editor để thử xuất lại"\n                  : selectedMode === "region"\n                    ? "Chọn lại vùng"\n                    : selectedMode === "element"\n                      ? "Chọn lại phần tử"\n                      : "Thử lại chụp toàn trang"}\n              </button>',
  ],
  [
    '        <span>Ảnh được xử lý và lưu cục bộ; không tải lên máy chủ.</span>',
    '        <span>Ảnh, source tiles và PDF được xử lý cục bộ; không tải lên máy chủ.</span>',
  ],
]);
