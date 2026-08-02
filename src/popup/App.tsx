import { useCallback, useEffect, useRef, useState } from "react";

import iconData from "../../assets/icons.json";

import { FOUNDATION_CAPABILITIES, type CaptureCapabilities } from "@shared/capabilities";
import type { ImageFormat, OutputFormat } from "@shared/contracts/domain";
import type { TabCapabilityPayload } from "@shared/contracts/messages";
import type {
  VisibleSessionSnapshot,
  VisibleSessionStatus,
} from "@shared/contracts/visible-session";

import { createArtifactPreview } from "./artifact-preview";
import { estimateOutputBytes, formatBytes } from "./formatting";
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

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "WebCap không thể hoàn tất thao tác.";
}

export function App(): React.JSX.Element {
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("checking");
  const [workerVersion, setWorkerVersion] = useState<string>();
  const [capabilities, setCapabilities] = useState<CaptureCapabilities>(FOUNDATION_CAPABILITIES);
  const [tabCapability, setTabCapability] = useState<TabCapabilityPayload>({
    status: "unavailable",
    errorCode: "E_TAB_NOT_ACTIVE",
  });
  const [selectedFormat, setSelectedFormat] = useState<ImageFormat>("png");
  const [session, setSession] = useState<VisibleSessionSnapshot>();
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
          const currentSession = await getVisibleSession();
          if (active) {
            setSession(currentSession);
            if (currentSession !== undefined) {
              setSelectedFormat(currentSession.format);
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
  const busy = status === "capturing" || status === "processing" || status === "downloading";
  const terminal = status === "ready" || status === "completed" || status === "error";
  const availableFormats = OUTPUT_FORMATS.filter(
    (format): format is { id: ImageFormat; label: string } =>
      format.id !== "pdf" && capabilities.outputFormats[format.id],
  );
  const canCapture =
    workerStatus === "connected" &&
    tabCapability.status === "supported" &&
    capabilities.modes.visible &&
    !busy;

  useEffect(() => {
    if (!busy) {
      return;
    }

    const timer = globalThis.setInterval(() => {
      void syncSession().catch(() => undefined);
    }, SESSION_POLL_MS);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [busy, syncSession]);

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

  const handleCapture = useCallback(async (): Promise<void> => {
    if (!canCapture) {
      return;
    }

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
  }, [canCapture, handleOperationError, runExport, selectedFormat, syncSession]);

  const handleCancel = useCallback(async (): Promise<void> => {
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
  }, [handleOperationError, session?.captureRequestId, status, syncSession]);

  const handleRetry = useCallback(async (): Promise<void> => {
    if (session?.source !== undefined) {
      await runExport(session.source.captureId, selectedFormat, IMAGE_QUALITY);
      return;
    }
    await handleCapture();
  }, [handleCapture, runExport, selectedFormat, session?.source]);

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

  const sourceEstimate =
    session?.source === undefined
      ? undefined
      : estimateOutputBytes(session.source.byteLength, selectedFormat);

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
            <h2 id="capture-title">Chụp vùng đang xem</h2>
          </div>
          <span className="planned-badge">S05</span>
        </div>

        <div className="mode-grid" aria-label="Các chế độ chụp">
          {CAPTURE_MODES.map((mode) => {
            const enabled = capabilities.modes[mode.id];
            return (
              <button
                className={`mode-button ${mode.id === "visible" ? "mode-button--selected" : ""}`}
                type="button"
                disabled={!enabled}
                aria-pressed={mode.id === "visible"}
                key={mode.id}
              >
                <span>{mode.label}</span>
                <small>{enabled ? "Khả dụng" : "Chưa khả dụng"}</small>
              </button>
            );
          })}
        </div>

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

        {status === "capturing" ? (
          <button
            className="primary-action primary-action--danger"
            type="button"
            onClick={() => void handleCancel()}
          >
            Hủy chụp
          </button>
        ) : session?.artifact === undefined ? (
          <button
            className="primary-action"
            type="button"
            disabled={!canCapture}
            onClick={() => void handleCapture()}
          >
            {busy ? "Đang xử lý…" : "Tạo bản xem trước"}
          </button>
        ) : null}

        {busy && (
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

        {session?.artifact !== undefined && (
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
                  onClick={() => void handleCapture()}
                >
                  Chụp lại
                </button>
              </div>
            </figcaption>
          </figure>
        )}

        <div className="capture-feedback" aria-live="polite">
          {status === "completed" && session?.downloadId !== undefined && (
            <p
              className="feedback feedback--success"
              data-testid="download-success"
              data-download-id={session.downloadId}
            >
              {CAPTURE_STATUS_COPY.completed}
            </p>
          )}
          {status === "cancelled" && (
            <div className="feedback feedback--neutral">
              <p>{CAPTURE_STATUS_COPY.cancelled}</p>
              <button
                className="text-action"
                type="button"
                disabled={!canCapture}
                onClick={() => void handleCapture()}
              >
                Thử lại
              </button>
            </div>
          )}
          {(status === "error" || uiError !== undefined) && (
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
        </div>
      </section>

      <footer>
        <span>Ảnh được xử lý và lưu cục bộ; không tải lên máy chủ.</span>
      </footer>
    </main>
  );
}
