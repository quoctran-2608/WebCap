import { useCallback, useEffect, useRef, useState } from "react";

import iconData from "../../assets/icons.json";

import { FOUNDATION_CAPABILITIES, type CaptureCapabilities } from "@shared/capabilities";
import type { CaptureJob, CaptureMode, ImageFormat, OutputFormat } from "@shared/contracts/domain";
import type { TabCapabilityPayload } from "@shared/contracts/messages";
import type {
  VisibleSessionSnapshot,
  VisibleSessionStatus,
} from "@shared/contracts/visible-session";

import { createArtifactPreview } from "./artifact-preview";
import { estimateOutputBytes, formatBytes } from "./formatting";
import {
  cancelFullPageCapture,
  getActiveCaptureJob,
  getCaptureJob,
  startElementCapture,
  startFullPageCapture,
  startRegionCapture,
} from "./full-page-client";
import {
  cancelVisibleCapture,
  downloadArtifact,
  exportImage,
  getCapabilities,
  getTabCapability,
  getVisibleSession,
  pingWorker,
  startVisibleCapture,
} from "./worker-client";

const CAPTURE_MODES = [
  { id: "visible", label: "Vùng đang xem" },
  { id: "full-page", label: "Toàn bộ trang" },
  { id: "region", label: "Vùng tự chọn" },
  { id: "element", label: "Phần tử" },
  { id: "scroll-area", label: "Vùng cuộn" },
] as const;

const OUTPUT_FORMATS: ReadonlyArray<{ id: OutputFormat; label: string }> = [
  { id: "png", label: "PNG" },
  { id: "jpeg", label: "JPEG" },
  { id: "webp", label: "WebP" },
  { id: "pdf", label: "PDF" },
];

const IMAGE_QUALITY = 0.92;
const SESSION_POLL_MS = 350;

type WorkerStatus = "checking" | "connected" | "unavailable";
type UiStatus = VisibleSessionStatus | "idle";

const STATUS_COPY: Record<WorkerStatus, string> = {
  checking: "Đang kết nối…",
  connected: "Đã kết nối",
  unavailable: "Không thể kết nối",
};

const TAB_STATUS_COPY: Record<TabCapabilityPayload["status"], string> = {
  supported: "Có thể chụp",
  unsupported: "URL không hỗ trợ",
  unavailable: "Không có tab hoạt động",
};

const CAPTURE_STATUS_COPY: Record<Exclude<UiStatus, "idle">, string> = {
  capturing: "Đang chụp tab hiện tại…",
  captured: "Đã chụp xong, chuẩn bị mã hóa…",
  processing: "Đang tạo ảnh xem trước…",
  ready: "Bản xem trước đã sẵn sàng.",
  downloading: "Đang bắt đầu tải xuống…",
  completed: "Tệp đã được gửi tới Chrome Downloads.",
  cancelled: "Đã hủy thao tác chụp.",
  error: "Không thể hoàn tất thao tác.",
};

const TILED_STATUS_COPY: Record<CaptureJob["state"], string> = {
  created: "Đang khởi tạo phiên chụp…",
  preparing: "Đang chuẩn bị và làm ổn định trang…",
  capturing: "Đang chụp các tile; WebCap tự chuyển sang scroll fallback khi cần…",
  processing: "Đang xác nhận tile set…",
  ready: "Tile set đã sẵn sàng để biên tập PDF.",
  exporting: "Đang tạo PDF từng trang…",
  completed: "PDF đã sẵn sàng để tải xuống.",
  failed: "Không thể hoàn tất chụp toàn trang.",
  cancelling: "Đang hủy và phục hồi trang…",
  cancelled: "Đã hủy chụp toàn trang.",
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "WebCap không thể hoàn tất thao tác.";
}

function tiledStatusCopy(job: CaptureJob): string {
  if (job.mode === "element") {
    if (job.state === "created") return "Chọn phần tử trực tiếp trên trang…";
    if (job.state === "ready") return "Tile set phần tử đã sẵn sàng.";
    if (job.state === "failed") return "Không thể hoàn tất chụp phần tử.";
    if (job.state === "cancelled") return "Đã hủy chọn phần tử.";
  }
  if (job.mode === "region") {
    if (job.state === "created") return "Chọn vùng trực tiếp trên trang…";
    if (job.state === "ready") return "Tile set vùng chọn đã sẵn sàng.";
    if (job.state === "failed") return "Không thể hoàn tất chụp vùng chọn.";
    if (job.state === "cancelled") return "Đã hủy chọn vùng.";
  }
  return TILED_STATUS_COPY[job.state];
}

function isFullPageBusy(job: CaptureJob | undefined): boolean {
  return (
    job !== undefined &&
    ["created", "preparing", "capturing", "processing", "exporting", "cancelling"].includes(
      job.state,
    )
  );
}

export function App(): React.JSX.Element {
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("checking");
  const [workerVersion, setWorkerVersion] = useState<string>();
  const [capabilities, setCapabilities] = useState<CaptureCapabilities>(FOUNDATION_CAPABILITIES);
  const [tabCapability, setTabCapability] = useState<TabCapabilityPayload>({
    status: "unavailable",
    errorCode: "E_TAB_NOT_ACTIVE",
  });
  const [selectedMode, setSelectedMode] = useState<CaptureMode>("visible");
  const [selectedFormat, setSelectedFormat] = useState<ImageFormat>("png");
  const [session, setSession] = useState<VisibleSessionSnapshot>();
  const [fullPageJob, setFullPageJob] = useState<CaptureJob>();
  const [localStatus, setLocalStatus] = useState<UiStatus>("idle");
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [uiError, setUiError] = useState<string>();
  const resumedSessionRef = useRef<string | undefined>(undefined);
  const activeCaptureRequestIdRef = useRef<string | undefined>(undefined);
  const feedbackHeadingRef = useRef<HTMLHeadingElement>(null);

  const syncSession = useCallback(async (): Promise<VisibleSessionSnapshot | undefined> => {
    const current = await getVisibleSession();
    setSession(current);
    if (current !== undefined) {
      setSelectedFormat(current.format);
    }
    return current;
  }, []);

  const syncFullPageJob = useCallback(async (jobId: string): Promise<CaptureJob> => {
    const current = await getCaptureJob(jobId);
    setFullPageJob(current);
    return current;
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const [response, workerCapabilities, currentTabCapability] = await Promise.all([
          pingWorker(),
          getCapabilities(),
          getTabCapability(),
        ]);
        if (!active) {
          return;
        }

        setWorkerVersion(response.payload.workerVersion);
        setCapabilities(workerCapabilities);
        setTabCapability(currentTabCapability);
        setWorkerStatus("connected");

        try {
          const [currentSession, activeJob] = await Promise.all([
            getVisibleSession(),
            currentTabCapability.tabId === undefined
              ? Promise.resolve(undefined)
              : getActiveCaptureJob(currentTabCapability.tabId),
          ]);
          if (active) {
            setSession(currentSession);
            if (currentSession !== undefined) {
              setSelectedFormat(currentSession.format);
            }
            if (
              activeJob !== undefined &&
              (activeJob.mode === "full-page" ||
                activeJob.mode === "region" ||
                activeJob.mode === "element")
            ) {
              setFullPageJob(activeJob);
              setSelectedMode(activeJob.mode);
            }
          }
        } catch (error) {
          if (active) {
            setUiError(errorMessage(error));
          }
        }
      } catch {
        if (active) {
          setWorkerStatus("unavailable");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const status: UiStatus = localStatus === "idle" ? (session?.status ?? "idle") : localStatus;
  const visibleBusy = status === "capturing" || status === "processing" || status === "downloading";
  const fullPageBusy = isFullPageBusy(fullPageJob);
  const tiledMode =
    selectedMode === "full-page" || selectedMode === "region" || selectedMode === "element";
  const busy = tiledMode ? fullPageBusy : visibleBusy;
  const terminal = tiledMode
    ? fullPageJob !== undefined &&
      ["ready", "exporting", "completed", "failed", "cancelled"].includes(fullPageJob.state)
    : status === "ready" || status === "completed" || status === "error";
  const availableFormats = OUTPUT_FORMATS.filter(
    (format): format is { id: ImageFormat; label: string } =>
      format.id !== "pdf" && capabilities.outputFormats[format.id],
  );
  const selectedModeEnabled = capabilities.modes[selectedMode];
  const canCapture =
    workerStatus === "connected" &&
    tabCapability.status === "supported" &&
    selectedModeEnabled &&
    !busy;

  useEffect(() => {
    if (!visibleBusy || selectedMode !== "visible") {
      return;
    }

    const timer = globalThis.setInterval(() => {
      void syncSession().catch(() => undefined);
    }, SESSION_POLL_MS);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [selectedMode, syncSession, visibleBusy]);

  useEffect(() => {
    if (!fullPageBusy || fullPageJob === undefined) {
      return;
    }

    const timer = globalThis.setInterval(() => {
      void syncFullPageJob(fullPageJob.id).catch((error: unknown) => {
        setUiError(errorMessage(error));
      });
    }, SESSION_POLL_MS);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [fullPageBusy, fullPageJob, syncFullPageJob]);

  useEffect(() => {
    if (terminal) {
      feedbackHeadingRef.current?.focus();
    }
  }, [terminal]);

  useEffect(() => {
    let disposed = false;
    let revoke: (() => void) | undefined;
    setPreviewUrl(undefined);

    if (session?.artifact === undefined) {
      return () => undefined;
    }

    void createArtifactPreview(session.artifact.artifactId)
      .then((preview) => {
        if (disposed) {
          preview.revoke();
          return;
        }
        revoke = () => preview.revoke();
        setPreviewUrl(preview.url);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setUiError(errorMessage(error));
        }
      });

    return () => {
      disposed = true;
      revoke?.();
    };
  }, [session?.artifact?.artifactId]);

  const handleOperationError = useCallback(
    async (error: unknown): Promise<void> => {
      const restored = await syncSession().catch(() => undefined);
      setLocalStatus("idle");
      setUiError(restored?.error?.message ?? errorMessage(error));
    },
    [syncSession],
  );

  const runExport = useCallback(
    async (sourceArtifactId: string, format: ImageFormat, quality: number): Promise<void> => {
      setLocalStatus("processing");
      setUiError(undefined);
      try {
        await exportImage({
          sourceArtifactId,
          format,
          quality,
          exportRequestId: crypto.randomUUID(),
        });
        await syncSession();
        setLocalStatus("idle");
      } catch (error) {
        await handleOperationError(error);
      }
    },
    [handleOperationError, syncSession],
  );

  useEffect(() => {
    if (session?.status !== "captured" || session.source === undefined) {
      return;
    }

    const resumeKey = `${session.sessionId}:${session.updatedAt}`;
    if (resumedSessionRef.current === resumeKey) {
      return;
    }
    resumedSessionRef.current = resumeKey;
    void runExport(session.source.captureId, session.format, session.quality);
  }, [runExport, session]);

  const handleVisibleCapture = useCallback(async (): Promise<void> => {
    const captureRequestId = crypto.randomUUID();
    activeCaptureRequestIdRef.current = captureRequestId;
    setSession(undefined);
    setLocalStatus("capturing");
    setUiError(undefined);

    try {
      const metadata = await startVisibleCapture({
        captureRequestId,
        outputFormat: selectedFormat,
        quality: IMAGE_QUALITY,
      });
      activeCaptureRequestIdRef.current = undefined;
      await runExport(metadata.captureId, selectedFormat, IMAGE_QUALITY);
    } catch (error) {
      activeCaptureRequestIdRef.current = undefined;
      await handleOperationError(error);
    }
  }, [handleOperationError, runExport, selectedFormat]);

  const handleFullPageCapture = useCallback(async (): Promise<void> => {
    if (tabCapability.tabId === undefined || tabCapability.windowId === undefined) {
      setUiError("Không xác định được tab đang hoạt động.");
      return;
    }
    setFullPageJob(undefined);
    setUiError(undefined);
    try {
      const job = await startFullPageCapture({
        tabId: tabCapability.tabId,
        windowId: tabCapability.windowId,
        outputFormat: selectedFormat,
      });
      setFullPageJob(job);
      await syncFullPageJob(job.id);
    } catch (error) {
      setUiError(errorMessage(error));
    }
  }, [selectedFormat, syncFullPageJob, tabCapability.tabId, tabCapability.windowId]);

  const handleRegionCapture = useCallback(async (): Promise<void> => {
    if (tabCapability.tabId === undefined || tabCapability.windowId === undefined) {
      setUiError("Không xác định được tab đang hoạt động.");
      return;
    }
    setFullPageJob(undefined);
    setUiError(undefined);
    try {
      const job = await startRegionCapture({
        tabId: tabCapability.tabId,
        windowId: tabCapability.windowId,
        outputFormat: selectedFormat,
      });
      setFullPageJob(job);
    } catch (error) {
      setUiError(errorMessage(error));
    }
  }, [selectedFormat, tabCapability.tabId, tabCapability.windowId]);

  const handleElementCapture = useCallback(async (): Promise<void> => {
    if (tabCapability.tabId === undefined || tabCapability.windowId === undefined) {
      setUiError("Không xác định được tab đang hoạt động.");
      return;
    }
    setFullPageJob(undefined);
    setUiError(undefined);
    try {
      const job = await startElementCapture({
        tabId: tabCapability.tabId,
        windowId: tabCapability.windowId,
        outputFormat: selectedFormat,
      });
      setFullPageJob(job);
    } catch (error) {
      setUiError(errorMessage(error));
    }
  }, [selectedFormat, tabCapability.tabId, tabCapability.windowId]);

  const handleCapture = useCallback(async (): Promise<void> => {
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
    if (selectedMode === "element") {
      await handleElementCapture();
      return;
    }
    await handleVisibleCapture();
  }, [
    canCapture,
    handleElementCapture,
    handleElementCapture,
    handleFullPageCapture,
    handleRegionCapture,
    handleVisibleCapture,
    selectedMode,
  ]);

  const handleCancel = useCallback(async (): Promise<void> => {
    if (selectedMode === "full-page" || selectedMode === "region" || selectedMode === "element") {
      if (fullPageJob === undefined) {
        return;
      }
      try {
        const job = await cancelFullPageCapture(fullPageJob.id);
        setFullPageJob(job);
        await syncFullPageJob(job.id);
      } catch (error) {
        setUiError(errorMessage(error));
      }
      return;
    }

    const captureRequestId = activeCaptureRequestIdRef.current ?? session?.captureRequestId;
    if (captureRequestId === undefined || status !== "capturing") {
      return;
    }

    try {
      await cancelVisibleCapture(captureRequestId);
      activeCaptureRequestIdRef.current = undefined;
      await syncSession();
      setLocalStatus("idle");
    } catch (error) {
      await handleOperationError(error);
    }
  }, [
    fullPageJob,
    handleOperationError,
    selectedMode,
    session?.captureRequestId,
    status,
    syncFullPageJob,
    syncSession,
  ]);

  const handleRetry = useCallback(async (): Promise<void> => {
    if (selectedMode === "full-page" || selectedMode === "region" || selectedMode === "element") {
      if (fullPageJob !== undefined && fullPageJob.state !== "cancelled") {
        await cancelFullPageCapture(fullPageJob.id).catch(() => undefined);
      }
      if (selectedMode === "region") {
        await handleRegionCapture();
      } else if (selectedMode === "element") {
        await handleElementCapture();
      } else {
        await handleFullPageCapture();
      }
      return;
    }
    if (session?.source !== undefined) {
      await runExport(session.source.captureId, selectedFormat, IMAGE_QUALITY);
      return;
    }
    await handleVisibleCapture();
  }, [
    fullPageJob,
    handleFullPageCapture,
    handleRegionCapture,
    handleVisibleCapture,
    runExport,
    selectedFormat,
    selectedMode,
    session?.source,
  ]);

  const handleDownload = useCallback(async (): Promise<void> => {
    if (session?.artifact === undefined) {
      return;
    }

    setLocalStatus("downloading");
    setUiError(undefined);
    try {
      await downloadArtifact(session.artifact.artifactId);
      await syncSession();
      setLocalStatus("idle");
    } catch (error) {
      await handleOperationError(error);
    }
  }, [handleOperationError, session?.artifact, syncSession]);

  const handleOpenPdfEditor = useCallback(async (): Promise<void> => {
    if (fullPageJob === undefined) return;
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`editor.html?jobId=${encodeURIComponent(fullPageJob.id)}`),
    });
    window.close();
  }, [fullPageJob]);

  const sourceEstimate =
    session?.source === undefined
      ? undefined
      : estimateOutputBytes(session.source.byteLength, selectedFormat);
  const fullPageProgress =
    fullPageJob === undefined || fullPageJob.totalTiles === 0
      ? 0
      : Math.round((fullPageJob.completedTiles / fullPageJob.totalTiles) * 100);

  return (
    <main className="popup-shell">
      <header className="brand">
        <img
          className="brand__icon"
          src={`data:image/png;base64,${iconData["48"]}`}
          alt=""
          width="40"
          height="40"
        />
        <div>
          <p className="brand__eyebrow">CHROME EXTENSION</p>
          <h1>WebCap</h1>
        </div>
      </header>

      <section className="status-card" aria-label="Trạng thái extension">
        <div className="status-row">
          <span>Service worker</span>
          <strong
            className={`status status--${workerStatus}`}
            data-testid="worker-status"
            data-status={workerStatus}
          >
            <span className="status__dot" aria-hidden="true" />
            {STATUS_COPY[workerStatus]}
          </strong>
        </div>
        <div className="status-row">
          <span>Phiên bản</span>
          <strong>{workerVersion ?? chrome.runtime.getManifest().version}</strong>
        </div>
        <div className="status-row">
          <span>Tab hiện tại</span>
          <strong
            className={`status status--${tabCapability.status === "supported" ? "connected" : "pending"}`}
            data-testid="tab-status"
            data-status={tabCapability.status}
          >
            {TAB_STATUS_COPY[tabCapability.status]}
          </strong>
        </div>
      </section>

      <section className="capture-panel" aria-labelledby="capture-title" aria-busy={busy}>
        <div className="section-heading">
          <div>
            <p className="section-heading__eyebrow">CHẾ ĐỘ CHỤP</p>
            <h2 id="capture-title">
              {selectedMode === "full-page"
                ? "Chụp toàn bộ trang"
                : selectedMode === "region"
                  ? "Chụp vùng tự chọn"
                  : selectedMode === "element"
                    ? "Chụp phần tử"
                    : "Chụp vùng đang xem"}
            </h2>
          </div>
          <span className="planned-badge">{selectedMode === "visible" ? "M1" : "S14"}</span>
        </div>

        <div className="mode-grid" aria-label="Các chế độ chụp">
          {CAPTURE_MODES.map((mode) => {
            const enabled = capabilities.modes[mode.id];
            const selected = mode.id === selectedMode;
            return (
              <button
                className={`mode-button ${selected ? "mode-button--selected" : ""}`}
                type="button"
                disabled={!enabled || busy}
                aria-pressed={selected}
                onClick={() => setSelectedMode(mode.id)}
                key={mode.id}
              >
                <span>{mode.label}</span>
                <small>{enabled ? "Khả dụng" : "Chưa khả dụng"}</small>
              </button>
            );
          })}
        </div>

        {selectedMode === "visible" ? (
          <>
            <label className="field-label" htmlFor="output-format">
              Định dạng đầu ra
            </label>
            <select
              id="output-format"
              aria-label="Định dạng đầu ra"
              value={selectedFormat}
              disabled={busy}
              onChange={(event) => setSelectedFormat(event.target.value as ImageFormat)}
            >
              {availableFormats.map((format) => (
                <option value={format.id} key={format.id}>
                  {format.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <p className="field-label">
            Đầu ra: PDF nhiều trang · chỉnh khổ giấy, lề, chất lượng và thứ tự sau khi chụp.
          </p>
        )}

        {busy ? (
          <button
            className="primary-action primary-action--danger"
            type="button"
            onClick={() => void handleCancel()}
          >
            Hủy chụp
          </button>
        ) : selectedMode === "visible" && session?.artifact !== undefined ? null : (
          <button
            className="primary-action"
            type="button"
            disabled={
              !canCapture || fullPageJob?.state === "ready" || fullPageJob?.state === "completed"
            }
            onClick={() => void handleCapture()}
          >
            {selectedMode === "full-page"
              ? "Bắt đầu chụp toàn trang"
              : selectedMode === "region"
                ? "Bắt đầu chọn vùng"
                : selectedMode === "element"
                  ? "Bắt đầu chọn phần tử"
                  : "Tạo bản xem trước"}
          </button>
        )}

        {tiledMode && fullPageJob !== undefined && (
          <section className="progress-card" aria-live="polite" data-testid="full-page-progress">
            {fullPageBusy && <span className="progress-card__spinner" aria-hidden="true" />}
            <div>
              <strong>{tiledStatusCopy(fullPageJob)}</strong>
              <small>
                {fullPageJob.completedTiles}/{fullPageJob.totalTiles || "?"} tile ·{" "}
                {fullPageProgress}%
              </small>
              <progress
                value={fullPageJob.completedTiles}
                max={Math.max(1, fullPageJob.totalTiles)}
                aria-label={
                  selectedMode === "region"
                    ? "Tiến độ chụp vùng chọn"
                    : selectedMode === "element"
                      ? "Tiến độ chụp phần tử"
                      : "Tiến độ chụp toàn trang"
                }
              />
            </div>
          </section>
        )}

        {selectedMode === "visible" && visibleBusy && (
          <section className="progress-card" aria-live="polite">
            <span className="progress-card__spinner" aria-hidden="true" />
            <div>
              <strong>{CAPTURE_STATUS_COPY[status as Exclude<UiStatus, "idle">]}</strong>
              {sourceEstimate !== undefined && (
                <small>
                  Ước tính {selectedFormat.toUpperCase()} · {formatBytes(sourceEstimate)}
                </small>
              )}
            </div>
          </section>
        )}

        {selectedMode === "visible" && session?.artifact !== undefined && (
          <figure
            className="preview-card"
            data-testid="preview-card"
            data-artifact-id={session.artifact.artifactId}
          >
            <div className="preview-card__media">
              {previewUrl === undefined ? (
                <div className="preview-card__placeholder">Đang tải bản xem trước…</div>
              ) : (
                <img
                  src={previewUrl}
                  alt="Bản xem trước ảnh chụp vùng đang xem"
                  data-testid="preview-image"
                />
              )}
            </div>
            <figcaption>
              <h3 ref={feedbackHeadingRef} tabIndex={-1} data-testid="preview-heading">
                Bản xem trước
              </h3>
              <dl
                className="preview-metadata"
                data-testid="preview-metadata"
                data-width={session.artifact.width}
                data-height={session.artifact.height}
                data-format={session.artifact.format}
                data-bytes={session.artifact.byteLength}
              >
                <div>
                  <dt>Kích thước</dt>
                  <dd>
                    {session.artifact.width} × {session.artifact.height} px
                  </dd>
                </div>
                <div>
                  <dt>Định dạng</dt>
                  <dd>{session.artifact.format.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Dung lượng</dt>
                  <dd>{formatBytes(session.artifact.byteLength)}</dd>
                </div>
              </dl>
              <div className="preview-actions">
                <button
                  className="primary-action"
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDownload()}
                >
                  {status === "downloading" ? "Đang tải…" : "Tải xuống"}
                </button>
                {session.source !== undefined && selectedFormat !== session.artifact.format && (
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRetry()}
                  >
                    Tạo lại định dạng
                  </button>
                )}
                <button
                  className="secondary-action"
                  type="button"
                  disabled={!canCapture}
                  onClick={() => void handleVisibleCapture()}
                >
                  Chụp lại
                </button>
              </div>
            </figcaption>
          </figure>
        )}

        <div className="capture-feedback" aria-live="polite">
          {tiledMode && fullPageJob?.state === "ready" && (
            <div className="feedback feedback--success">
              <h3 ref={feedbackHeadingRef} tabIndex={-1}>
                {selectedMode === "region"
                  ? "Đã lưu tile vùng chọn"
                  : selectedMode === "element"
                    ? "Đã lưu tile phần tử"
                    : "Đã lưu đầy đủ tile"}
              </h3>
              <p>
                {fullPageJob.completedTiles} source tile đang được giữ cục bộ. Mở editor để xem
                thumbnail, đổi khổ giấy, sắp xếp hoặc bỏ trang và tạo PDF mà không chụp lại.
              </p>
              <button
                className="primary-action"
                type="button"
                onClick={() => void handleOpenPdfEditor()}
              >
                Mở trình biên tập PDF
              </button>
            </div>
          )}
          {tiledMode && fullPageJob?.state === "completed" && (
            <div className="feedback feedback--success">
              <h3 ref={feedbackHeadingRef} tabIndex={-1}>
                PDF đã sẵn sàng
              </h3>
              <p>Mở editor để tải file PDF đã tạo.</p>
              <button
                className="primary-action"
                type="button"
                onClick={() => void handleOpenPdfEditor()}
              >
                Mở và tải PDF
              </button>
            </div>
          )}
          {tiledMode && fullPageJob?.state === "cancelled" && (
            <div className="feedback feedback--neutral">
              <p>{tiledStatusCopy(fullPageJob)}</p>
              <button className="text-action" type="button" onClick={() => void handleRetry()}>
                Thử lại
              </button>
            </div>
          )}
          {tiledMode && fullPageJob?.state === "failed" && (
            <div className="feedback feedback--error" role="alert">
              <h3 ref={feedbackHeadingRef} tabIndex={-1}>
                {selectedMode === "region"
                  ? "Không thể hoàn tất chụp vùng chọn"
                  : selectedMode === "element"
                    ? "Không thể hoàn tất chụp phần tử"
                    : "Không thể hoàn tất chụp toàn trang"}
              </h3>
              <p>
                {fullPageJob.error?.message ??
                  (selectedMode === "region"
                    ? "Không thể chụp vùng đã chọn."
                    : selectedMode === "element"
                      ? "Phần tử đã chọn không còn hợp lệ hoặc không thể chụp."
                      : "Không thể chụp toàn bộ trang.")}
              </p>
              {fullPageJob.activeEngine === "scroll" && (
                <p>Scroll fallback đã dừng an toàn và trang đã được phục hồi.</p>
              )}
              <button
                className="text-action"
                type="button"
                onClick={() =>
                  fullPageJob.totalTiles > 0 &&
                  fullPageJob.completedTiles === fullPageJob.totalTiles
                    ? void handleOpenPdfEditor()
                    : void handleRetry()
                }
              >
                {fullPageJob.totalTiles > 0 && fullPageJob.completedTiles === fullPageJob.totalTiles
                  ? "Mở editor để thử xuất lại"
                  : selectedMode === "region"
                    ? "Chọn lại vùng"
                    : selectedMode === "element"
                      ? "Chọn lại phần tử"
                      : "Thử lại chụp toàn trang"}
              </button>
            </div>
          )}
          {selectedMode === "visible" &&
            status === "completed" &&
            session?.downloadId !== undefined && (
              <p
                className="feedback feedback--success"
                data-testid="download-success"
                data-download-id={session.downloadId}
              >
                {CAPTURE_STATUS_COPY.completed}
              </p>
            )}
          {selectedMode === "visible" && status === "cancelled" && (
            <div className="feedback feedback--neutral">
              <p>{CAPTURE_STATUS_COPY.cancelled}</p>
              <button
                className="text-action"
                type="button"
                disabled={!canCapture}
                onClick={() => void handleVisibleCapture()}
              >
                Thử lại
              </button>
            </div>
          )}
          {selectedMode === "visible" && (status === "error" || uiError !== undefined) && (
            <div className="feedback feedback--error" role="alert">
              <h3
                ref={session?.artifact === undefined ? feedbackHeadingRef : undefined}
                tabIndex={-1}
              >
                Không thể hoàn tất
              </h3>
              <p>{session?.error?.message ?? uiError ?? CAPTURE_STATUS_COPY.error}</p>
              {(session?.error?.retryable ?? true) && (
                <button
                  className="text-action"
                  type="button"
                  disabled={busy || workerStatus !== "connected"}
                  onClick={() => void handleRetry()}
                >
                  Thử lại
                </button>
              )}
            </div>
          )}
          {selectedMode === "full-page" &&
            uiError !== undefined &&
            fullPageJob?.state !== "failed" && (
              <div className="feedback feedback--error" role="alert">
                <p>{uiError}</p>
              </div>
            )}
        </div>
      </section>

      <footer>
        <span>Ảnh, source tiles và PDF được xử lý cục bộ; không tải lên máy chủ.</span>
      </footer>
    </main>
  );
}
