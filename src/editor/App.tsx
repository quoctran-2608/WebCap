import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { downloadArtifact } from "@popup/worker-client";
import type {
  PdfEditorPage,
  PdfEditorSettings,
  PdfEditorSnapshot,
} from "@shared/contracts/pdf-editor";
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";

import {
  cancelPdfEditorExport,
  getPdfEditorSnapshot,
  startPdfEditorExport,
  updatePdfEditor,
} from "./editor-client";
import { createPdfPageThumbnail } from "./thumbnail-service";

const artifacts = new IndexedDbArtifactRepository();

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Không thể hoàn thành thao tác PDF.";
}

interface PageThumbnailProps {
  snapshot: PdfEditorSnapshot;
  page: PdfEditorPage;
}

function PageThumbnail({ snapshot, page }: PageThumbnailProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    let observer: IntersectionObserver | undefined;

    const load = async () => {
      try {
        const metadata = await createPdfPageThumbnail({
          jobId: snapshot.job.id,
          manifestRevision: snapshot.manifest.revision,
          page,
          tiles: snapshot.job.tilePlan,
          expiresAt: snapshot.job.expiresAt,
        });
        const record = await artifacts.get(metadata.artifactId);
        if (!active || record?.blob === undefined) return;
        objectUrl = URL.createObjectURL(record.blob);
        setUrl(objectUrl);
      } catch {
        if (active) setFailed(true);
      }
    };

    const target = containerRef.current;
    if (target === null || typeof IntersectionObserver === "undefined") {
      void load();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            void load();
          }
        },
        { rootMargin: "240px" },
      );
      observer.observe(target);
    }

    return () => {
      active = false;
      observer?.disconnect();
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [page, snapshot.job, snapshot.manifest.revision]);

  return (
    <div className="thumbnail" ref={containerRef} aria-busy={url === undefined && !failed}>
      {url === undefined ? (
        <span>{failed ? "Không tạo được ảnh xem trước" : "Đang tải ảnh xem trước…"}</span>
      ) : (
        <img src={url} alt={`Ảnh xem trước ${page.id}`} />
      )}
    </div>
  );
}

export interface PdfEditorAppProps {
  jobId: string;
}

export function PdfEditorApp({ jobId }: PdfEditorAppProps) {
  const [snapshot, setSnapshot] = useState<PdfEditorSnapshot>();
  const [draftSettings, setDraftSettings] = useState<PdfEditorSettings>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Đang tải dữ liệu biên tập…");
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const next = await getPdfEditorSnapshot(jobId);
    setSnapshot(next);
    setDraftSettings(next.manifest.settings);
    return next;
  }, [jobId]);

  useEffect(() => {
    let active = true;
    void refresh()
      .then(() => {
        if (active) setNotice("Bản chỉnh sửa được lưu tự động trong trình duyệt.");
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (snapshot?.job.state !== "exporting") return;
    const timer = globalThis.setInterval(() => {
      void getPdfEditorSnapshot(jobId)
        .then((next) => {
          setSnapshot(next);
          if (next.job.state !== "exporting") {
            setDraftSettings(next.manifest.settings);
            setNotice(
              next.job.state === "completed"
                ? "PDF đã sẵn sàng để tải xuống."
                : next.job.state === "failed"
                  ? "Xuất PDF thất bại. Source tiles vẫn được giữ để thử lại."
                  : "Đã dừng xuất PDF; bạn có thể chỉnh sửa hoặc xuất lại.",
            );
          }
        })
        .catch((cause) => setError(errorMessage(cause)));
    }, 400);
    return () => globalThis.clearInterval(timer);
  }, [jobId, snapshot?.job.state]);

  const progress = useMemo(() => {
    const current = snapshot?.job.exportProgress;
    if (current === undefined || current.totalPages === 0) return 0;
    return Math.round((current.completedPages / current.totalPages) * 100);
  }, [snapshot?.job.exportProgress]);

  const mutate = useCallback(
    async (operation: () => Promise<PdfEditorSnapshot>, success: string) => {
      setBusy(true);
      setError(undefined);
      try {
        const next = await operation();
        setSnapshot(next);
        setDraftSettings(next.manifest.settings);
        setNotice(success);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const updatePageIds = useCallback(
    (pageIds: string[], success: string) => {
      if (snapshot === undefined) return;
      void mutate(
        () =>
          updatePdfEditor(snapshot.job.id, snapshot.manifest.revision, {
            kind: "pages",
            pageIds,
          }),
        success,
      );
    },
    [mutate, snapshot],
  );

  const movePage = useCallback(
    (index: number, offset: -1 | 1) => {
      if (snapshot === undefined) return;
      const target = index + offset;
      if (target < 0 || target >= snapshot.manifest.pages.length) return;
      const pageIds = snapshot.manifest.pages.map((page) => page.id);
      const current = pageIds[index];
      const adjacent = pageIds[target];
      if (current === undefined || adjacent === undefined) return;
      pageIds[index] = adjacent;
      pageIds[target] = current;
      updatePageIds(pageIds, "Đã cập nhật thứ tự trang.");
    },
    [snapshot, updatePageIds],
  );

  const removePage = useCallback(
    (pageId: string) => {
      if (snapshot === undefined || snapshot.manifest.pages.length <= 1) return;
      updatePageIds(
        snapshot.manifest.pages.filter((page) => page.id !== pageId).map((page) => page.id),
        "Đã loại trang khỏi bản PDF. Source tile gốc không bị xóa.",
      );
    },
    [snapshot, updatePageIds],
  );

  if (snapshot === undefined || draftSettings === undefined) {
    return (
      <main className="editor-shell loading-shell">
        <h1>Trình biên tập PDF</h1>
        <p role={error === undefined ? "status" : "alert"}>{error ?? notice}</p>
      </main>
    );
  }

  const exporting = snapshot.job.state === "exporting";
  const completed = snapshot.job.state === "completed";
  const canEdit = !exporting && !completed && !busy;
  const canExport = ["ready", "failed"].includes(snapshot.job.state) && !busy;

  const applySettings = () => {
    void mutate(
      () =>
        updatePdfEditor(snapshot.job.id, snapshot.manifest.revision, {
          kind: "settings",
          settings: draftSettings,
        }),
      "Đã áp dụng tùy chọn và tính lại danh sách trang.",
    );
  };

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <div>
          <span className="eyebrow">WEBCAP · PDF</span>
          <h1>Trình biên tập PDF</h1>
          <p>{snapshot.job.source.title ?? "Bản chụp trang web"}</p>
        </div>
        <div className="header-summary" aria-label="Tóm tắt tài liệu">
          <strong>{snapshot.manifest.pages.length} trang</strong>
          <span>Ước tính xấp xỉ {formatBytes(snapshot.estimate.estimatedBytes)}</span>
        </div>
      </header>

      <div className="editor-layout">
        <section className="pages-panel" aria-labelledby="pages-heading">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Bố cục</span>
              <h2 id="pages-heading">Các trang PDF</h2>
            </div>
            <span className="keyboard-hint">Alt + ↑/↓ để đổi vị trí</span>
          </div>

          <div className="page-grid">
            {snapshot.manifest.pages.map((page, index) => (
              <article
                className="page-card"
                key={page.id}
                tabIndex={0}
                aria-label={`Trang ${index + 1} trong ${snapshot.manifest.pages.length}`}
                onKeyDown={(event) => {
                  if (!canEdit || !event.altKey) return;
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    movePage(index, -1);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    movePage(index, 1);
                  }
                }}
              >
                <PageThumbnail snapshot={snapshot} page={page} />
                <div className="page-card-body">
                  <div>
                    <strong>Trang {index + 1}</strong>
                    <span>Nguồn #{page.originalIndex + 1}</span>
                  </div>
                  <div className="page-actions" aria-label={`Thao tác trang ${index + 1}`}>
                    <button
                      type="button"
                      onClick={() => movePage(index, -1)}
                      disabled={!canEdit || index === 0}
                      aria-label={`Đưa trang ${index + 1} lên trước`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => movePage(index, 1)}
                      disabled={!canEdit || index === snapshot.manifest.pages.length - 1}
                      aria-label={`Đưa trang ${index + 1} xuống sau`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => removePage(page.id)}
                      disabled={!canEdit || snapshot.manifest.pages.length <= 1}
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="settings-panel" aria-labelledby="settings-heading">
          <span className="section-kicker">Thiết lập</span>
          <h2 id="settings-heading">Tùy chọn xuất PDF</h2>

          <label>
            Khổ giấy
            <select
              value={draftSettings.pageSize}
              onChange={(event) =>
                setDraftSettings({
                  ...draftSettings,
                  pageSize: event.target.value as PdfEditorSettings["pageSize"],
                })
              }
              disabled={!canEdit}
            >
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
              <option value="fit-width">Vừa chiều rộng</option>
            </select>
          </label>

          <label>
            Hướng giấy
            <select
              value={draftSettings.orientation}
              onChange={(event) =>
                setDraftSettings({
                  ...draftSettings,
                  orientation: event.target.value as PdfEditorSettings["orientation"],
                })
              }
              disabled={!canEdit}
            >
              <option value="portrait">Dọc</option>
              <option value="landscape">Ngang</option>
            </select>
          </label>

          <label>
            Lề trang: {draftSettings.marginMm} mm
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              value={draftSettings.marginMm}
              onChange={(event) =>
                setDraftSettings({ ...draftSettings, marginMm: Number(event.target.value) })
              }
              disabled={!canEdit}
            />
          </label>

          <label>
            Chất lượng JPEG: {Math.round(draftSettings.jpegQuality * 100)}%
            <input
              type="range"
              min="0.4"
              max="1"
              step="0.05"
              value={draftSettings.jpegQuality}
              onChange={(event) =>
                setDraftSettings({ ...draftSettings, jpegQuality: Number(event.target.value) })
              }
              disabled={!canEdit}
            />
          </label>

          <button
            type="button"
            className="secondary-action"
            onClick={applySettings}
            disabled={!canEdit}
          >
            Áp dụng tùy chọn
          </button>

          <div className="estimate-card">
            <span>Kích thước xấp xỉ</span>
            <strong>{formatBytes(snapshot.estimate.estimatedBytes)}</strong>
            <small>
              Ước tính từ source tiles, chất lượng và số trang; file thực tế có thể khác.
            </small>
          </div>

          {exporting ? (
            <div className="export-progress" aria-live="polite">
              <div>
                <strong>Đang tạo PDF</strong>
                <span>{progress}%</span>
              </div>
              <progress value={progress} max="100" />
              <p>
                Trang {snapshot.job.exportProgress?.completedPages ?? 0}/
                {snapshot.job.exportProgress?.totalPages ?? snapshot.manifest.pages.length}
              </p>
              <button
                type="button"
                className="danger-action"
                onClick={() =>
                  void mutate(
                    () => cancelPdfEditorExport(snapshot.job.id),
                    "Đã yêu cầu dừng xuất PDF.",
                  )
                }
                disabled={busy}
              >
                Dừng xuất
              </button>
            </div>
          ) : completed && snapshot.job.outputArtifactId !== undefined ? (
            <button
              type="button"
              className="primary-action"
              onClick={() =>
                void mutate(async () => {
                  await downloadArtifact(snapshot.job.outputArtifactId ?? "");
                  return refresh();
                }, "Đã bắt đầu tải PDF.")
              }
              disabled={busy}
            >
              Tải PDF xuống
            </button>
          ) : (
            <button
              type="button"
              className="primary-action"
              onClick={() =>
                void mutate(
                  () => startPdfEditorExport(snapshot.job.id),
                  snapshot.job.state === "failed"
                    ? "Đang thử lại export từ source tiles đã lưu."
                    : "Đã bắt đầu tạo PDF.",
                )
              }
              disabled={!canExport}
            >
              {snapshot.job.state === "failed" ? "Thử xuất lại" : "Tạo PDF"}
            </button>
          )}

          <p className="status-message" role={error === undefined ? "status" : "alert"}>
            {error ?? notice}
          </p>
        </aside>
      </div>
    </main>
  );
}
