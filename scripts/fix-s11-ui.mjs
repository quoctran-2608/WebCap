import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected text not found in ${path}: ${before.slice(0, 180)}`);
  }
  await writeFile(path, source.replace(before, after), "utf8");
}

await replaceOnce(
  "src/popup/App.tsx",
  `  const handleCapture = useCallback(async (): Promise<void> => {
    if (!canCapture) {
      return;
    }
    if (selectedMode === "full-page" || selectedMode === "region") {
      if (selectedMode === "region") {
        await handleRegionCapture();
      } else {
        await handleFullPageCapture();
      }
      return;
    }
    if (selectedMode === "region") {
      await handleRegionCapture();
      return;
    }
    await handleVisibleCapture();
  }, [canCapture, handleFullPageCapture, handleRegionCapture, handleVisibleCapture, selectedMode]);`,
  `  const handleCapture = useCallback(async (): Promise<void> => {
    if (!canCapture) {
      return;
    }
    if (selectedMode === "full-page") {
      await handleFullPageCapture();
      return;
    }
    if (selectedMode === "region") {
      await handleRegionCapture();
      return;
    }
    await handleVisibleCapture();
  }, [canCapture, handleFullPageCapture, handleRegionCapture, handleVisibleCapture, selectedMode]);`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `  const handleCancel = useCallback(async (): Promise<void> => {
    if (selectedMode === "full-page") {`,
  `  const handleCancel = useCallback(async (): Promise<void> => {
    if (selectedMode === "full-page" || selectedMode === "region") {`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `  const handleRetry = useCallback(async (): Promise<void> => {
    if (selectedMode === "full-page" || selectedMode === "region") {
      if (fullPageJob !== undefined && fullPageJob.state !== "cancelled") {
        await cancelFullPageCapture(fullPageJob.id).catch(() => undefined);
      }
      await handleFullPageCapture();
      return;
    }`,
  `  const handleRetry = useCallback(async (): Promise<void> => {
    if (selectedMode === "full-page" || selectedMode === "region") {
      if (fullPageJob !== undefined && fullPageJob.state !== "cancelled") {
        await cancelFullPageCapture(fullPageJob.id).catch(() => undefined);
      }
      if (selectedMode === "region") {
        await handleRegionCapture();
      } else {
        await handleFullPageCapture();
      }
      return;
    }`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `                aria-label="Tiến độ chụp toàn trang"`,
  `                aria-label={
                  selectedMode === "region" ? "Tiến độ chụp vùng chọn" : "Tiến độ chụp toàn trang"
                }`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `{selectedMode === "full-page" && fullPageJob?.state === "ready" && (
            <div className="feedback feedback--success">
              <h3 ref={feedbackHeadingRef} tabIndex={-1}>
                Đã lưu đầy đủ tile
              </h3>
              <p>
                {fullPageJob.completedTiles} tile PNG đang được giữ cục bộ trong IndexedDB. Ghép ảnh
                toàn trang và export cuối thuộc milestone S10/S13.
              </p>
              <button className="text-action" type="button" onClick={() => void handleCancel()}>
                Kết thúc phiên tile
              </button>
            </div>
          )}`,
  `{tiledMode && fullPageJob?.state === "ready" && (
            <div className="feedback feedback--success">
              <h3 ref={feedbackHeadingRef} tabIndex={-1}>
                {selectedMode === "region" ? "Đã lưu tile vùng chọn" : "Đã lưu đầy đủ tile"}
              </h3>
              <p>
                {fullPageJob.completedTiles} tile PNG đang được giữ cục bộ trong IndexedDB. Ghép ảnh
                và export cuối thuộc milestone xuất kết quả sau S12.
              </p>
              <button className="text-action" type="button" onClick={() => void handleCancel()}>
                Kết thúc phiên tile
              </button>
            </div>
          )}`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `{selectedMode === "full-page" && fullPageJob?.state === "cancelled" && (
            <div className="feedback feedback--neutral">
              <p>{FULL_PAGE_STATUS_COPY.cancelled}</p>
              <button className="text-action" type="button" onClick={() => void handleRetry()}>
                Thử lại
              </button>
            </div>
          )}`,
  `{tiledMode && fullPageJob?.state === "cancelled" && (
            <div className="feedback feedback--neutral">
              <p>{tiledStatusCopy(fullPageJob)}</p>
              <button className="text-action" type="button" onClick={() => void handleRetry()}>
                Thử lại
              </button>
            </div>
          )}`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `{selectedMode === "full-page" && fullPageJob?.state === "failed" && (
            <div className="feedback feedback--error" role="alert">
              <h3 ref={feedbackHeadingRef} tabIndex={-1}>
                Không thể hoàn tất chụp toàn trang
              </h3>
              <p>{fullPageJob.error?.message ?? "Không thể chụp toàn bộ trang."}</p>
              {fullPageJob.activeEngine === "scroll" && (
                <p>Scroll fallback đã dừng an toàn và trang đã được phục hồi.</p>
              )}
              <button className="text-action" type="button" onClick={() => void handleRetry()}>
                Thử lại chụp toàn trang
              </button>
            </div>
          )}`,
  `{tiledMode && fullPageJob?.state === "failed" && (
            <div className="feedback feedback--error" role="alert">
              <h3 ref={feedbackHeadingRef} tabIndex={-1}>
                {selectedMode === "region"
                  ? "Không thể hoàn tất chụp vùng chọn"
                  : "Không thể hoàn tất chụp toàn trang"}
              </h3>
              <p>
                {fullPageJob.error?.message ??
                  (selectedMode === "region"
                    ? "Không thể chụp vùng đã chọn."
                    : "Không thể chụp toàn bộ trang.")}
              </p>
              {fullPageJob.activeEngine === "scroll" && (
                <p>Scroll fallback đã dừng an toàn và trang đã được phục hồi.</p>
              )}
              <button className="text-action" type="button" onClick={() => void handleRetry()}>
                {selectedMode === "region" ? "Chọn lại vùng" : "Thử lại chụp toàn trang"}
              </button>
            </div>
          )}`,
);
