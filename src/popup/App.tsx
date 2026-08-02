import { useEffect, useState } from "react";

import iconData from "../../assets/icons.json";

import { FOUNDATION_CAPABILITIES, type CaptureCapabilities } from "@shared/capabilities";
import type { CaptureMode, OutputFormat } from "@shared/contracts/domain";

import { getCapabilities, pingWorker } from "./worker-client";

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

const STATUS_COPY: Record<WorkerStatus, string> = {
  checking: "Đang kết nối…",
  connected: "Đã kết nối",
  unavailable: "Không thể kết nối",
};

export function App(): React.JSX.Element {
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("checking");
  const [workerVersion, setWorkerVersion] = useState<string>();
  const [capabilities, setCapabilities] = useState<CaptureCapabilities>(FOUNDATION_CAPABILITIES);

  useEffect(() => {
    let active = true;

    void Promise.all([pingWorker(), getCapabilities()])
      .then(([response, workerCapabilities]) => {
        if (!active) {
          return;
        }

        setWorkerVersion(response.payload.workerVersion);
        setCapabilities(workerCapabilities);
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

  const availableFormats = OUTPUT_FORMATS.filter((format) => capabilities.outputFormats[format.id]);

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
          <span>Cấu hình cục bộ</span>
          <strong className="status status--connected">
            {capabilities.settings ? "Sẵn sàng" : "Chưa khả dụng"}
          </strong>
        </div>
        <div className="status-row">
          <span>Tab hiện tại</span>
          <strong className="status status--pending">Kiểm tra ở S03</strong>
        </div>
      </section>

      <section className="capture-panel" aria-labelledby="capture-title">
        <div className="section-heading">
          <div>
            <p className="section-heading__eyebrow">CHẾ ĐỘ CHỤP</p>
            <h2 id="capture-title">Nền tảng đã sẵn sàng</h2>
          </div>
          <span className="planned-badge">Sắp mở</span>
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
          disabled={availableFormats.length === 0}
          defaultValue={availableFormats[0]?.id}
        >
          {availableFormats.length === 0 ? (
            <option value="">Chưa khả dụng</option>
          ) : (
            availableFormats.map((format) => (
              <option value={format.id} key={format.id}>
                {format.label}
              </option>
            ))
          )}
        </select>

        <button className="primary-action" type="button" disabled>
          Bắt đầu chụp
        </button>
      </section>

      <footer>
        <span>Thiết lập được lưu cục bộ trên thiết bị.</span>
      </footer>
    </main>
  );
}
