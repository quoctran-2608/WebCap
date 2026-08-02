import { useEffect, useState } from "react";

import iconData from "../../assets/icons.json";

import { pingWorker } from "./worker-client";

const CAPTURE_MODES = [
  "Vùng đang xem",
  "Toàn bộ trang",
  "Vùng tự chọn",
  "Phần tử",
  "Vùng cuộn",
] as const;

type WorkerStatus = "checking" | "connected" | "unavailable";

const STATUS_COPY: Record<WorkerStatus, string> = {
  checking: "Đang kết nối…",
  connected: "Đã kết nối",
  unavailable: "Không thể kết nối",
};

export function App(): React.JSX.Element {
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("checking");
  const [workerVersion, setWorkerVersion] = useState<string>();

  useEffect(() => {
    let active = true;

    void pingWorker()
      .then((response) => {
        if (!active) {
          return;
        }

        setWorkerVersion(response.payload.workerVersion);
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
          <strong className="status status--pending">Kiểm tra ở S02</strong>
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

        <div className="mode-grid" aria-label="Các chế độ sẽ được triển khai">
          {CAPTURE_MODES.map((mode) => (
            <button className="mode-button" type="button" disabled key={mode}>
              <span>{mode}</span>
              <small>Chưa khả dụng</small>
            </button>
          ))}
        </div>

        <label className="field-label" htmlFor="output-format">
          Định dạng đầu ra
        </label>
        <select id="output-format" disabled defaultValue="png">
          <option value="png">PNG</option>
        </select>

        <button className="primary-action" type="button" disabled>
          Bắt đầu chụp
        </button>
      </section>

      <footer>
        <span>Cài đặt sẽ được kích hoạt ở milestone tiếp theo.</span>
      </footer>
    </main>
  );
}
