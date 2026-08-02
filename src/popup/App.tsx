import { useEffect, useState } from "react";

import iconData from "../../assets/icons.json";

import { FOUNDATION_CAPABILITIES, type CaptureCapabilities } from "@shared/capabilities";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureMode, ImageFormat, OutputFormat } from "@shared/contracts/domain";
import type { TabCapabilityPayload } from "@shared/contracts/messages";

import {
  cancelVisibleCapture,
  downloadArtifact,
  exportImage,
  getCapabilities,
  getTabCapability,
  pingWorker,
  startVisibleCapture,
} from "./worker-client";

const CAPTURE_MODES: ReadonlyArray<{ id: CaptureMode; label: string }> = [
  { id: "visible", label: "Vùng đang xem" },
  { id: "full-page", label: "Toàn bộ trang" },
  { id: "region", label: "Vùng tự chọn" },
  { id: "element", label: "Phần tử" },
  { id: "scroll-area", label: "Vùng cuộn" },
];

const OUTPUT_FORMATS: ReadonlyArray<{ id: OutputFormat; label: string }> = [
  { id: "png", label: "PNG" },
  { id: "jpeg", label: "JPEG" },
  { id: "webp", label: "WebP" },
  { id: "pdf", label: "PDF" },
];

type WorkerStatus = "checking" | "connected" | "unavailable";
type CaptureStatus =
  "idle" | "capturing" | "processing" | "downloading" | "completed" | "error" | "cancelled";

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

function formatBytes(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`;
  }
  return `${(byteLength / 1024).toFixed(1)} KB`;
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
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [captureRequestId, setCaptureRequestId] = useState<string>();
  const [artifact, setArtifact] = useState<ArtifactMetadata>();
  const [captureError, setCaptureError] = useState<string>();

  useEffect(() => {
    let active = true;

    void Promise.all([pingWorker(), getCapabilities(), getTabCapability()])
      .then(([response, workerCapabilities, currentTabCapability]) => {
        if (!active) {
          return;
        }

        setWorkerVersion(response.payload.workerVersion);
        setCapabilities(workerCapabilities);
        setTabCapability(currentTabCapability);
        setWorkerStatus("connected");
      })
      .catch(() => {
        if (active) {
          setWorkerStatus("unavailable");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const availableFormats = OUTPUT_FORMATS.filter(
    (format): format is { id: ImageFormat; label: string } =>
      format.id !== "pdf" && capabilities.outputFormats[format.id],
  );
  const busy = ["capturing", "processing", "downloading"].includes(captureStatus);
  const canCapture =
    workerStatus === "connected" &&
    tabCapability.status === "supported" &&
    capabilities.modes.visible &&
    !busy;

  const handleCapture = (): void => {
    const requestId = crypto.randomUUID();
    setCaptureRequestId(requestId);
    setArtifact(undefined);
    setCaptureError(undefined);
    setCaptureStatus("capturing");

    void startVisibleCapture({ captureRequestId: requestId })
      .then(async (metadata) => {
        setCaptureStatus("processing");
        const exported = await exportImage({
          sourceArtifactId: metadata.captureId,
          format: selectedFormat,
          quality: 0.92,
        });
        setArtifact(exported);
        setCaptureStatus("downloading");
        await downloadArtifact(exported.artifactId);
        setCaptureStatus("completed");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "E_CANCELLED") {
          setCaptureStatus("cancelled");
          return;
        }

        setCaptureError(error instanceof Error ? error.message : "Không thể tạo ảnh tải xuống.");
        setCaptureStatus("error");
      });
  };

  const handleCancel = (): void => {
    if (captureRequestId === undefined || captureStatus !== "capturing") {
      return;
    }

    void cancelVisibleCapture(captureRequestId)
      .then((accepted) => {
        if (accepted) {
          setCaptureStatus("cancelled");
        }
      })
      .catch((error: unknown) => {
        setCaptureError(error instanceof Error ? error.message : "Không thể hủy thao tác chụp.");
        setCaptureStatus("error");
      });
  };

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

      <section className="capture-panel" aria-labelledby="capture-title">
        <div className="section-heading">
          <div>
            <p className="section-heading__eyebrow">CHẾ ĐỘ CHỤP</p>
            <h2 id="capture-title">Chụp và tải xuống</h2>
          </div>
          <span className="planned-badge">S04</span>
        </div>

        <div className="mode-grid" aria-label="Các chế độ chụp">
          {CAPTURE_MODES.map((mode) => {
            const enabled = capabilities.modes[mode.id];
            return (
              <button className="mode-button" type="button" disabled={!enabled} key={mode.id}>
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

        {captureStatus === "capturing" ? (
          <button className="primary-action" type="button" onClick={handleCancel}>
            Hủy chụp
          </button>
        ) : (
          <button
            className="primary-action"
            type="button"
            disabled={!canCapture}
            onClick={handleCapture}
          >
            {busy ? "Đang xử lý…" : "Chụp và tải xuống"}
          </button>
        )}

        <div className="capture-feedback" aria-live="polite">
          {captureStatus === "capturing" && <p>Đang chụp tab hiện tại…</p>}
          {captureStatus === "processing" && <p>Đang mã hóa ảnh trong offscreen document…</p>}
          {captureStatus === "downloading" && <p>Đang bắt đầu tải xuống…</p>}
          {captureStatus === "cancelled" && <p>Đã hủy thao tác chụp.</p>}
          {captureStatus === "error" && <p role="alert">{captureError}</p>}
          {captureStatus === "completed" && artifact !== undefined && (
            <p data-testid="capture-success">
              Đã tải {artifact.filename} · {artifact.width} × {artifact.height} px ·{" "}
              {formatBytes(artifact.byteLength)}.
            </p>
          )}
        </div>
      </section>

      <footer>
        <span>Ảnh được xử lý và lưu cục bộ; không tải lên máy chủ.</span>
      </footer>
    </main>
  );
}
