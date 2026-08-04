import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { downloadArtifact } from "@popup/worker-client";
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";
import { copyText } from "@shared/clipboard";
import type {
  PdfEditorPage,
  PdfEditorSettings,
  PdfEditorSnapshot,
} from "@shared/contracts/pdf-editor";
import { serializeSafeDiagnostics } from "@shared/diagnostics";
import { WebCapRuntimeError } from "@shared/errors/error";
import { errorPresentation, t, type UiLocale } from "@shared/i18n";
import { useUiLocale } from "@shared/use-ui-locale";

import {
  cancelPdfEditorExport,
  getPdfEditorSnapshot,
  getPdfEditorThumbnail,
  startPdfEditorExport,
  updatePdfEditor,
} from "./editor-client";

const artifacts = new IndexedDbArtifactRepository();

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function localizedError(locale: UiLocale, error: unknown): string {
  const presentation =
    error instanceof WebCapRuntimeError
      ? errorPresentation(locale, error.data)
      : errorPresentation(locale, "E_UNKNOWN");
  return `${presentation.message} ${presentation.action}`;
}

interface PageThumbnailProps {
  snapshot: PdfEditorSnapshot;
  page: PdfEditorPage;
  eager: boolean;
  locale: UiLocale;
}

function PageThumbnail({ snapshot, page, eager, locale }: PageThumbnailProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    let observer: IntersectionObserver | undefined;

    const load = async () => {
      try {
        const metadata = await getPdfEditorThumbnail(
          snapshot.job.id,
          snapshot.manifest.revision,
          page.id,
        );
        const record = await artifacts.get(metadata.artifactId);
        if (!active || record?.blob === undefined) return;
        objectUrl = URL.createObjectURL(record.blob);
        setUrl(objectUrl);
      } catch {
        if (active) setFailed(true);
      }
    };

    const target = containerRef.current;
    if (eager || target === null || typeof IntersectionObserver === "undefined") {
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
  }, [eager, page.id, snapshot.job.id, snapshot.manifest.revision]);

  return (
    <div className="thumbnail" ref={containerRef} aria-busy={url === undefined && !failed}>
      {url === undefined ? (
        <span>
          {failed ? t(locale, "editor.previewFailed") : t(locale, "editor.previewLoading")}
        </span>
      ) : (
        <img src={url} alt={t(locale, "editor.previewAlt", { page: page.originalIndex + 1 })} />
      )}
    </div>
  );
}

export function InvalidPdfEditor(): React.JSX.Element {
  const { locale, setLocale } = useUiLocale();
  return (
    <main className="editor-shell loading-shell">
      <div className="loading-card">
        <h1>{t(locale, "editor.title")}</h1>
        <p role="alert">{t(locale, "editor.invalidJob")}</p>
        <label className="editor-locale-control">
          <span>{t(locale, "common.language")}</span>
          <select
            value={locale}
            onChange={(event) => void setLocale(event.target.value as UiLocale)}
          >
            <option value="vi">{t(locale, "common.vietnamese")}</option>
            <option value="en">{t(locale, "common.english")}</option>
          </select>
        </label>
      </div>
    </main>
  );
}

export interface PdfEditorAppProps {
  jobId: string;
}

export function PdfEditorApp({ jobId }: PdfEditorAppProps) {
  const { locale, setLocale } = useUiLocale();
  const [snapshot, setSnapshot] = useState<PdfEditorSnapshot>();
  const [draftSettings, setDraftSettings] = useState<PdfEditorSettings>();
  const [busy, setBusy] = useState(false);
  const [noticeKey, setNoticeKey] = useState<Parameters<typeof t>[1]>("editor.loading");
  const [error, setError] = useState<string>();
  const [downloadId, setDownloadId] = useState<number>();
  const [diagnosticsNotice, setDiagnosticsNotice] = useState<string>();

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
        if (active) setNoticeKey("editor.autosaved");
      })
      .catch((cause: unknown) => {
        if (active) setError(localizedError(locale, cause));
      });
    return () => {
      active = false;
    };
  }, [locale, refresh]);

  useEffect(() => {
    if (snapshot?.job.state !== "exporting") return;
    const timer = globalThis.setInterval(() => {
      void getPdfEditorSnapshot(jobId)
        .then((next) => {
          setSnapshot(next);
          if (next.job.state !== "exporting") {
            setDraftSettings(next.manifest.settings);
            setError(undefined);
            setNoticeKey(
              next.job.state === "completed"
                ? "editor.exportCompleted"
                : next.job.state === "failed"
                  ? next.job.error?.code === "E_MEMORY_GUARD"
                    ? "editor.memoryGuard"
                    : "editor.exportFailed"
                  : "editor.exportCancelled",
            );
          }
        })
        .catch((cause: unknown) => setError(localizedError(locale, cause)));
    }, 400);
    return () => globalThis.clearInterval(timer);
  }, [jobId, locale, snapshot?.job.state]);

  const progress = useMemo(() => {
    const current = snapshot?.job.exportProgress;
    if (current === undefined || current.totalPages === 0) return 0;
    return Math.round((current.completedPages / current.totalPages) * 100);
  }, [snapshot?.job.exportProgress]);

  const mutate = useCallback(
    async (operation: () => Promise<PdfEditorSnapshot>, successKey: Parameters<typeof t>[1]) => {
      setBusy(true);
      setError(undefined);
      try {
        const next = await operation();
        setSnapshot(next);
        setDraftSettings(next.manifest.settings);
        setNoticeKey(successKey);
      } catch (cause) {
        setError(localizedError(locale, cause));
      } finally {
        setBusy(false);
      }
    },
    [locale],
  );

  const downloadPdf = useCallback(async () => {
    const artifactId = snapshot?.job.outputArtifactId;
    if (artifactId === undefined) return;
    setBusy(true);
    setError(undefined);
    setDownloadId(undefined);
    try {
      const nextDownloadId = await downloadArtifact(artifactId);
      setDownloadId(nextDownloadId);
      setNoticeKey("editor.downloadStarted");
    } catch (cause) {
      setError(localizedError(locale, cause));
    } finally {
      setBusy(false);
    }
  }, [locale, snapshot?.job.outputArtifactId]);

  const updatePageIds = useCallback(
    (pageIds: string[], successKey: Parameters<typeof t>[1]) => {
      if (snapshot === undefined) return;
      void mutate(
        () =>
          updatePdfEditor(snapshot.job.id, snapshot.manifest.revision, {
            kind: "pages",
            pageIds,
          }),
        successKey,
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
      updatePageIds(pageIds, "editor.orderUpdated");
    },
    [snapshot, updatePageIds],
  );

  const removePage = useCallback(
    (pageId: string) => {
      if (snapshot === undefined || snapshot.manifest.pages.length <= 1) return;
      updatePageIds(
        snapshot.manifest.pages.filter((page) => page.id !== pageId).map((page) => page.id),
        "editor.pageRemoved",
      );
    },
    [snapshot, updatePageIds],
  );

  const diagnosticsJson = useMemo(
    () =>
      serializeSafeDiagnostics({
        extensionVersion: chrome.runtime.getManifest().version,
        locale,
        surface: "editor",
        chromeVersion: navigator.userAgent,
        ...(snapshot === undefined
          ? {}
          : {
              job: {
                id: snapshot.job.id,
                mode: snapshot.job.mode,
                state: snapshot.job.state,
                ...(snapshot.job.activeEngine === undefined
                  ? {}
                  : { engine: snapshot.job.activeEngine }),
                completedTiles: snapshot.job.completedTiles,
                totalTiles: snapshot.job.totalTiles,
                ...(snapshot.job.error === undefined ? {} : { errorCode: snapshot.job.error.code }),
              },
            }),
      }),
    [locale, snapshot],
  );

  const copyDiagnostics = useCallback(async () => {
    try {
      await copyText(diagnosticsJson);
      setDiagnosticsNotice(t(locale, "common.diagnosticsCopied"));
    } catch {
      setDiagnosticsNotice(t(locale, "common.diagnosticsCopyFailed"));
    }
  }, [diagnosticsJson, locale]);

  if (snapshot === undefined || draftSettings === undefined) {
    return (
      <main className="editor-shell loading-shell">
        <div className="loading-card">
          <h1>{t(locale, "editor.title")}</h1>
          <p role={error === undefined ? "status" : "alert"}>{error ?? t(locale, noticeKey)}</p>
        </div>
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
      "editor.settingsApplied",
    );
  };

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <div>
          <span className="eyebrow">WEBCAP · PDF</span>
          <h1>{t(locale, "editor.title")}</h1>
          <p>{snapshot.job.source.title ?? t(locale, "editor.fallbackTitle")}</p>
        </div>
        <div className="editor-header-actions">
          <label className="editor-locale-control">
            <span>{t(locale, "common.language")}</span>
            <select
              value={locale}
              data-testid="editor-locale-select"
              onChange={(event) => void setLocale(event.target.value as UiLocale)}
            >
              <option value="vi">{t(locale, "common.vietnamese")}</option>
              <option value="en">{t(locale, "common.english")}</option>
            </select>
          </label>
          <button
            className="secondary-action compact-action"
            type="button"
            data-testid="editor-copy-diagnostics"
            onClick={() => void copyDiagnostics()}
          >
            {t(locale, "common.copyDiagnostics")}
          </button>
          {diagnosticsNotice !== undefined && (
            <span className="diagnostics-notice" role="status" aria-live="polite">
              {diagnosticsNotice}
            </span>
          )}
          <div className="header-summary" aria-label={t(locale, "editor.summary")}>
            <strong>
              {t(locale, "editor.pagesCount", { count: snapshot.manifest.pages.length })}
            </strong>
            <span>
              {t(locale, "editor.approxEstimate", {
                bytes: formatBytes(snapshot.estimate.estimatedBytes),
              })}
            </span>
          </div>
        </div>
      </header>

      <div className="editor-layout">
        <section className="pages-panel" aria-labelledby="pages-heading">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t(locale, "editor.layout")}</span>
              <h2 id="pages-heading">{t(locale, "editor.pages")}</h2>
            </div>
            <span className="keyboard-hint">{t(locale, "editor.keyboardHint")}</span>
          </div>

          <div className="page-grid">
            {snapshot.manifest.pages.map((page, index) => (
              <article
                className="page-card"
                key={page.id}
                tabIndex={0}
                aria-label={t(locale, "editor.pageLabel", {
                  page: index + 1,
                  total: snapshot.manifest.pages.length,
                })}
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
                <PageThumbnail
                  snapshot={snapshot}
                  page={page}
                  eager={index === 0}
                  locale={locale}
                />
                <div className="page-card-body">
                  <div>
                    <strong>{t(locale, "editor.page", { page: index + 1 })}</strong>
                    <span>{t(locale, "editor.source", { source: page.originalIndex + 1 })}</span>
                  </div>
                  <div
                    className="page-actions"
                    aria-label={t(locale, "editor.pageActions", { page: index + 1 })}
                  >
                    <button
                      type="button"
                      onClick={() => movePage(index, -1)}
                      disabled={!canEdit || index === 0}
                      aria-label={t(locale, "editor.moveBefore", { page: index + 1 })}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => movePage(index, 1)}
                      disabled={!canEdit || index === snapshot.manifest.pages.length - 1}
                      aria-label={t(locale, "editor.moveAfter", { page: index + 1 })}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => removePage(page.id)}
                      disabled={!canEdit || snapshot.manifest.pages.length <= 1}
                    >
                      {t(locale, "editor.delete")}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="settings-panel" aria-labelledby="settings-heading">
          <span className="section-kicker">{t(locale, "editor.settings")}</span>
          <h2 id="settings-heading">{t(locale, "editor.exportOptions")}</h2>

          <label>
            {t(locale, "editor.pageSize")}
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
              <option value="fit-width">{t(locale, "editor.fitWidth")}</option>
            </select>
          </label>

          <label>
            {t(locale, "editor.orientation")}
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
              <option value="portrait">{t(locale, "editor.portrait")}</option>
              <option value="landscape">{t(locale, "editor.landscape")}</option>
            </select>
          </label>

          <label>
            {t(locale, "editor.margin", { value: draftSettings.marginMm })}
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
            {t(locale, "editor.jpegQuality", {
              value: Math.round(draftSettings.jpegQuality * 100),
            })}
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
            {t(locale, "editor.apply")}
          </button>

          <div className="estimate-card">
            <span>{t(locale, "editor.approxSize")}</span>
            <strong>{formatBytes(snapshot.estimate.estimatedBytes)}</strong>
            <small>{t(locale, "editor.estimateDetail")}</small>
          </div>

          {exporting ? (
            <div className="export-progress" aria-live="polite">
              <div>
                <strong>{t(locale, "editor.exporting")}</strong>
                <span>{progress}%</span>
              </div>
              <progress value={progress} max="100" />
              <p>
                {t(locale, "editor.exportPage", {
                  completed: snapshot.job.exportProgress?.completedPages ?? 0,
                  total: snapshot.job.exportProgress?.totalPages ?? snapshot.manifest.pages.length,
                })}
              </p>
              <button
                type="button"
                className="danger-action"
                onClick={() =>
                  void mutate(() => cancelPdfEditorExport(snapshot.job.id), "editor.stopRequested")
                }
                disabled={busy}
              >
                {t(locale, "editor.stopExport")}
              </button>
            </div>
          ) : completed && snapshot.job.outputArtifactId !== undefined ? (
            <button
              type="button"
              className="primary-action"
              onClick={() => void downloadPdf()}
              disabled={busy}
            >
              {t(locale, "editor.downloadPdf")}
            </button>
          ) : (
            <button
              type="button"
              className="primary-action"
              onClick={() =>
                void mutate(
                  () => startPdfEditorExport(snapshot.job.id),
                  snapshot.job.state === "failed" ? "editor.retryStarted" : "editor.exportStarted",
                )
              }
              disabled={!canExport}
            >
              {snapshot.job.state === "failed"
                ? t(locale, "editor.retryExport")
                : t(locale, "editor.createPdf")}
            </button>
          )}

          <p
            className="status-message"
            data-testid="download-status"
            data-download-id={downloadId}
            role={error === undefined ? "status" : "alert"}
            aria-live="polite"
          >
            {error ?? t(locale, noticeKey)}
          </p>
        </aside>
      </div>
    </main>
  );
}
