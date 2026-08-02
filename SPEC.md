---
product: WebCap
document: Engineering Specification
version: 1.0
date: 2026-08-02
status: Approved for implementation
repository: quoctran-2608/WebCap
owner: OpenAI coding agent
language: vi
prd: ./PRD_WebCap_v1.0.md
---

# WebCap — Engineering Specification

> Đây là đặc tả kỹ thuật có tính ràng buộc để triển khai WebCap. PRD mô tả **cần xây gì**; tài liệu này mô tả **xây như thế nào**, theo thứ tự nào, interface nào phải ổn định và điều kiện nào phải đạt trước khi chuyển milestone.

# 1. Cách sử dụng tài liệu

Mỗi lần tiếp tục dự án, agent/developer phải thực hiện theo thứ tự:

1. Đọc `PRD_WebCap_v1.0.md` để xác nhận mục tiêu và phạm vi.
2. Đọc toàn bộ `SPEC.md`, đặc biệt các mục “Quyết định đã khóa”, “Hợp đồng dữ liệu” và milestone hiện tại.
3. Kiểm tra repo, issue, PR, CI và milestone gần nhất đã hoàn thành.
4. Chỉ triển khai một lát cắt có thể kiểm thử; không viết nhiều subsystem dở dang cùng lúc.
5. Thêm hoặc cập nhật test trong cùng commit với implementation.
6. Chạy lint, typecheck, unit test và các test liên quan trước khi push.
7. Cập nhật checklist milestone và ADR nếu thay đổi quyết định kiến trúc.

Các thay đổi trái với tài liệu này phải đi kèm một ADR trong `docs/adr/` và cập nhật lại `SPEC.md` trong cùng PR.

# 2. Mục tiêu kỹ thuật

WebCap phải là Chrome Extension Manifest V3, local-first, có thể:

- chụp viewport;
- chụp toàn bộ document dài bằng Chrome DevTools Protocol;
- fallback bằng scroll-and-capture khi CDP không dùng được;
- chụp vùng hình chữ nhật, phần tử DOM và scrollable container;
- xử lý nội dung theo tile, không phụ thuộc canvas khổng lồ;
- preview và xuất PNG/JPEG/WebP/PDF;
- phục hồi đầy đủ trạng thái trang sau success, error hoặc cancel;
- không upload ảnh hoặc nội dung trang lên backend trong MVP.

# 3. Quyết định đã khóa

| ID | Quyết định | Lý do |
| --- | --- | --- |
| ADR-0001 | Manifest V3 | Nền tảng extension hiện hành; background dùng service worker. |
| ADR-0002 | TypeScript strict | Giảm lỗi message contract, state machine và coordinate math. |
| ADR-0003 | Vite + React | Build nhanh, UI popup/editor dùng chung component model. |
| ADR-0004 | pnpm | Lockfile chặt, cài đặt nhanh và dễ kiểm soát dependency. |
| ADR-0005 | Minimum Chrome 116 | Có `runtime.getContexts()` để quản lý offscreen document nhất quán. |
| ADR-0006 | CDP là full-page engine chính | `Page.getLayoutMetrics` và `Page.captureScreenshot` hỗ trợ clip ngoài viewport. |
| ADR-0007 | Scroll capture là fallback | Bao phủ lỗi debugger/CDP và các target đặc biệt. |
| ADR-0008 | IndexedDB lưu tile binary | Không đẩy binary lớn qua service worker hoặc `chrome.storage`. |
| ADR-0009 | `chrome.storage.session` chỉ giữ metadata ngắn hạn | Quota hữu hạn; phù hợp trạng thái service worker nhưng không phù hợp ảnh. |
| ADR-0010 | Offscreen document xử lý Blob/canvas/PDF | Service worker không có DOM; offscreen dùng runtime messaging. |
| ADR-0011 | Không backend/analytics mặc định | Giảm rủi ro privacy và phạm vi MVP. |
| ADR-0012 | PDF MVP dùng `pdf-lib` | API TypeScript rõ, phù hợp ghép ảnh thành PDF; phải benchmark trước M4. |
| ADR-0013 | Test runner là Vitest; E2E là Playwright | Unit nhanh và có khả năng chạy Chromium với extension. |
| ADR-0014 | Mỗi job có một coordinator duy nhất | Tránh duplicate capture, race và debugger attach chồng. |

Quyết định có thể benchmark lại nhưng không được tự ý đổi trong implementation.

# 4. Stack và phiên bản

Phiên bản dependency chính xác sẽ được pin trong lockfile khi bootstrap M0. Chính sách:

- Node.js LTS đang được GitHub Actions hỗ trợ.
- TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- React và React DOM cùng major.
- Vite và plugin React cùng major tương thích.
- Vitest cùng hệ Vite.
- Playwright pin version và cài Chromium tương ứng.
- `zod` cho validation ở biên message/storage.
- `idb` hoặc wrapper rất mỏng quanh IndexedDB.
- `pdf-lib` cho PDF export.
- Không thêm state management library ở M0–M2; dùng store nhỏ dựa trên React context hoặc `useSyncExternalStore`.
- Không dùng thư viện screenshot DOM như html2canvas làm engine chính.
- Không tải script từ CDN, remote module hoặc `eval`.

# 5. Cấu trúc repository đích

```text
WebCap/
├── PRD_WebCap_v1.0.md
├── SPEC.md
├── README.md
├── CHANGELOG.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── eslint.config.js
├── .prettierrc.json
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml
├── docs/
│   ├── adr/
│   ├── testing.md
│   └── privacy.md
├── public/
│   ├── icons/
│   └── manifest.json
├── src/
│   ├── background/
│   │   ├── service-worker.ts
│   │   ├── message-router.ts
│   │   ├── job-coordinator.ts
│   │   ├── debugger-client.ts
│   │   ├── permission-service.ts
│   │   └── download-service.ts
│   ├── capture/
│   │   ├── capture-engine.ts
│   │   ├── cdp-capture-engine.ts
│   │   ├── scroll-capture-engine.ts
│   │   ├── tile-planner.ts
│   │   ├── overlap-resolver.ts
│   │   └── capture-policy.ts
│   ├── content/
│   │   ├── entry.ts
│   │   ├── page-metrics.ts
│   │   ├── page-preparer.ts
│   │   ├── page-restorer.ts
│   │   ├── region-selector.ts
│   │   ├── element-selector.ts
│   │   ├── scroll-container.ts
│   │   └── overlay/
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   ├── entry.ts
│   │   ├── offscreen-service.ts
│   │   ├── image-processor.ts
│   │   ├── thumbnail-service.ts
│   │   └── pdf-exporter.ts
│   ├── popup/
│   │   ├── popup.html
│   │   ├── entry.tsx
│   │   ├── App.tsx
│   │   └── components/
│   ├── editor/
│   │   ├── editor.html
│   │   ├── entry.tsx
│   │   ├── App.tsx
│   │   └── components/
│   ├── storage/
│   │   ├── job-repository.ts
│   │   ├── settings-repository.ts
│   │   ├── tile-repository.ts
│   │   └── database.ts
│   ├── shared/
│   │   ├── contracts/
│   │   ├── errors/
│   │   ├── constants.ts
│   │   ├── result.ts
│   │   ├── logger.ts
│   │   └── filename.ts
│   └── styles/
└── tests/
    ├── unit/
    ├── integration/
    ├── e2e/
    ├── fixtures/
    ├── golden/
    └── helpers/
```

Không tạo barrel file sâu gây circular dependency. Import theo alias rõ ràng:

```json
{
  "@background/*": ["src/background/*"],
  "@capture/*": ["src/capture/*"],
  "@content/*": ["src/content/*"],
  "@offscreen/*": ["src/offscreen/*"],
  "@shared/*": ["src/shared/*"],
  "@storage/*": ["src/storage/*"]
}
```

# 6. Manifest V3

Manifest mục tiêu ở M0:

```json
{
  "manifest_version": 3,
  "name": "WebCap",
  "description": "Chụp viewport, toàn trang, vùng chọn và xuất ảnh/PDF.",
  "version": "0.1.0",
  "minimum_chrome_version": "116",
  "action": {
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "downloads",
    "offscreen",
    "debugger"
  ],
  "optional_host_permissions": [
    "http://*/*",
    "https://*/*",
    "file:///*"
  ],
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

Nguyên tắc quyền:

- Không thêm `<all_urls>` vào `host_permissions` mặc định.
- `activeTab` là luồng chuẩn khi người dùng chủ động bấm extension.
- Chỉ xin optional host permission khi PDF/iframe/fetch thực sự cần.
- `debugger` chỉ attach trong khoảng capture; mọi exit path phải detach.
- Không thêm quyền mới nếu không có yêu cầu PRD và ADR.

# 7. Hợp đồng domain

## 7.1 Kiểu cơ bản

```ts
export type CaptureMode =
  | "visible"
  | "full-page"
  | "region"
  | "element"
  | "scroll-area";

export type CaptureEngineKind = "cdp" | "scroll";

export type JobState =
  | "created"
  | "preparing"
  | "capturing"
  | "processing"
  | "ready"
  | "exporting"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled";

export type FixedElementMode = "preserve" | "smart" | "remove";
export type ImageFormat = "png" | "jpeg" | "webp";
export type OutputFormat = ImageFormat | "pdf";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageMetrics {
  document: Rect;
  layoutViewport: Rect;
  visualViewport: Rect & { scale: number };
  devicePixelRatio: number;
  zoomFactor: number;
  scrollX: number;
  scrollY: number;
}

export interface CaptureTile {
  id: string;
  jobId: string;
  index: number;
  row: number;
  column: number;
  sourceRectCss: Rect;
  expectedPixelWidth: number;
  expectedPixelHeight: number;
  overlapTopCss: number;
  overlapLeftCss: number;
  status: "planned" | "capturing" | "stored" | "failed";
  attempts: number;
  byteLength?: number;
  mimeType?: string;
  checksum?: string;
}
```

Tất cả tọa độ capture plan dùng CSS pixel. Chuyển đổi sang device pixel chỉ tại biên decode/crop và phải dùng cùng một helper được unit-test.

## 7.2 Capture job

```ts
export interface CaptureJob {
  schemaVersion: 1;
  id: string;
  tabId: number;
  windowId: number;
  source: {
    title?: string;
    origin?: string;
    createdAt: string;
  };
  mode: CaptureMode;
  preferredEngine: CaptureEngineKind;
  activeEngine?: CaptureEngineKind;
  state: JobState;
  stateRevision: number;
  metrics?: PageMetrics;
  targetRect?: Rect;
  tilePlan: CaptureTile[];
  completedTiles: number;
  totalTiles: number;
  settings: CaptureSettings;
  cleanup: CleanupState;
  error?: WebCapErrorData;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
```

`stateRevision` tăng sau mỗi mutation. Repository dùng compare-and-set logic để reject update cũ.

## 7.3 Settings

```ts
export interface CaptureSettings {
  outputFormat: OutputFormat;
  imageQuality: number;
  fixedElementMode: FixedElementMode;
  lazyLoad: {
    enabled: boolean;
    stepRatio: number;
    settleMs: number;
    maxDurationMs: number;
  };
  limits: {
    maxCssHeight: number;
    maxCssWidth: number;
    maxTiles: number;
    maxEstimatedBytes: number;
  };
  pdf: {
    pageSize: "a4" | "letter" | "fit-width";
    orientation: "portrait" | "landscape";
    marginMm: number;
    jpegQuality: number;
  };
}
```

Giá trị mặc định ban đầu:

- tile target height: 8192 CSS px;
- tile target width: 8192 CSS px;
- overlap fallback: 64 CSS px;
- lazy-load step ratio: 0.8 viewport;
- settle: 250 ms;
- max lazy-load duration: 15 s;
- max tiles: 256;
- max CSS height tự động: 100.000 px trước khi cảnh báo;
- JPEG quality: 0.9;
- PDF margin: 8 mm.

Các giá trị phải nằm trong `src/shared/constants.ts`, không hard-code rải rác.

# 8. Message protocol

Mọi message là discriminated union, validate bằng Zod tại receiver.

```ts
export interface Envelope<TType extends string, TPayload> {
  protocolVersion: 1;
  requestId: string;
  jobId?: string;
  source: "popup" | "editor" | "background" | "content" | "offscreen";
  target: "popup" | "editor" | "background" | "content" | "offscreen";
  type: TType;
  payload: TPayload;
  sentAt: string;
}
```

Các command bắt buộc:

| Type | Từ → đến | Payload chính |
| --- | --- | --- |
| `JOB_CREATE` | popup → background | mode, settings, active tab |
| `JOB_CANCEL` | popup/editor → background | reason |
| `JOB_GET` | UI → background | jobId |
| `PAGE_MEASURE` | background → content | target mode |
| `PAGE_PREPARE` | background → content | fixed mode, lazy policy |
| `PAGE_RESTORE` | background → content | restore token |
| `REGION_SELECT_START` | background → content | selector settings |
| `ELEMENT_SELECT_START` | background → content | selector settings |
| `CAPTURE_TILE_PROCESS` | background → offscreen | tile metadata + tile key |
| `EXPORT_START` | editor → background | output settings |
| `EXPORT_PROCESS` | background → offscreen | jobId + output settings |
| `JOB_PROGRESS` | background → UI | state, completed, total |
| `JOB_FAILED` | background → UI | normalized error |
| `JOB_COMPLETED` | background → UI | artifact metadata |

Quy tắc:

- Handler phải idempotent theo `requestId` hoặc `(jobId, tile.index, action)`.
- Message không chứa base64 ảnh lớn.
- Kết quả binary được lưu IndexedDB và message chỉ truyền key/metadata.
- Timeout mặc định request-response là 10 giây; capture tile và export dùng progress event thay vì giữ một message port vô hạn.
- Unknown protocol version trả `E_PROTOCOL_VERSION`.

# 9. State machine

Các transition hợp lệ:

```text
created -> preparing
preparing -> capturing | failed | cancelling
capturing -> processing | failed | cancelling
processing -> ready | failed | cancelling
ready -> exporting | cancelling
exporting -> completed | ready | failed | cancelling
cancelling -> cancelled
failed -> preparing | capturing | exporting | cancelled
completed -> (terminal)
cancelled -> (terminal)
```

Không được set state trực tiếp ngoài `JobCoordinator.transition()`.

Invariant:

- `capturing` yêu cầu `activeEngine` và `totalTiles > 0`.
- `ready` yêu cầu mọi tile cần thiết ở trạng thái `stored`.
- `exporting` yêu cầu artifact source còn tồn tại.
- `completed`, `failed`, `cancelled` phải có cleanup đã chạy hoặc cleanup error được ghi rõ.
- Một tab chỉ có tối đa một capture job ở trạng thái non-terminal.

# 10. Storage

## 10.1 `chrome.storage.local`

Dùng cho:

- user settings;
- schema version;
- feature flags cục bộ;
- migration marker.

Không lưu ảnh hoặc tile.

## 10.2 `chrome.storage.session`

Dùng cho:

- job summary đang hoạt động;
- lock theo tab;
- last progress snapshot;
- offscreen readiness marker có thể tái tạo.

Giữ dưới 1 MB thực tế dù quota lớn hơn. Không ghi progress mỗi pixel; throttle tối đa 4 lần/giây.

## 10.3 IndexedDB

Database: `webcap-db`, version 1.

Object stores:

| Store | Key | Nội dung |
| --- | --- | --- |
| `jobs` | jobId | Full job record và recovery metadata. |
| `tiles` | `[jobId, index]` | Blob, dimensions, checksum, status. |
| `artifacts` | artifactId | Blob kết quả, MIME, filename, expiry. |
| `dedupe` | requestId | Kết quả handler ngắn hạn để idempotency. |

Index:

- `tiles.byJobId`;
- `artifacts.byJobId`;
- `jobs.byState`;
- `jobs.byExpiresAt`.

Cleanup chạy khi extension startup, trước job mới và sau download. Tile/job bỏ dở quá 30 phút được xóa, trừ khi editor đang mở và lease còn hạn.

# 11. Offscreen document lifecycle

`OffscreenService.ensureDocument()`:

1. Dùng `chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })`.
2. Nếu đã tồn tại đúng URL, return.
3. Nếu đang có promise tạo document, await cùng promise.
4. Gọi `chrome.offscreen.createDocument()` với:
   - URL tĩnh `offscreen.html`;
   - reasons gồm `BLOBS` và `WORKERS` nếu Chrome chấp nhận tổ hợp;
   - justification mô tả encode ảnh và tạo PDF cục bộ.
5. Handshake `OFFSCREEN_READY` trước khi gửi job.

Chỉ có một offscreen document. Không close giữa từng tile; đóng khi không còn job/editor lease và idle timeout 60 giây.

# 12. Capture engine contract

```ts
export interface CaptureEngine {
  readonly kind: CaptureEngineKind;
  canHandle(context: CaptureContext): Promise<CapabilityResult>;
  measure(context: CaptureContext): Promise<PageMetrics>;
  plan(context: CaptureContext, metrics: PageMetrics): Promise<CaptureTile[]>;
  captureTile(context: CaptureContext, tile: CaptureTile): Promise<CapturedTile>;
  cleanup(context: CaptureContext): Promise<void>;
}
```

`JobCoordinator` không biết chi tiết CDP hoặc scroll. Engine không tự điều khiển UI. Engine chỉ phát progress/capability/error qua callback typed.

# 13. CDP capture engine

## 13.1 Attach/detach

- Attach bằng `chrome.debugger.attach({ tabId }, "0.1")` ngay trước đo/chụp.
- Register `onDetach` theo tab và session.
- `finally` luôn gọi detach; bỏ qua lỗi “not attached” đã được normalize.
- Nếu DevTools mở và session bị ngắt, phát `E_DEBUGGER_DETACHED` và cho coordinator quyết định fallback.
- Không giữ debugger attach trong preview/export.

## 13.2 Đo trang

Gọi:

1. `Page.enable`;
2. `Page.getLayoutMetrics`;
3. ưu tiên `cssContentSize`, `cssLayoutViewport`, `cssVisualViewport`;
4. đối chiếu với content-script metrics để phát hiện sai lệch > 2 CSS px.

Nếu document size thay đổi trong quá trình pre-scroll, đo lại trước khi lập tile plan.

## 13.3 Tile planner

Input: target rect theo CSS pixel.

Algorithm:

1. Clamp target vào document bounds.
2. Chọn width/height tile sao cho mỗi cạnh ≤ target constants và pixel area không vượt guardrail.
3. Nếu width vượt ngưỡng, chia cả X và Y.
4. CDP tile mặc định không cần overlap; fallback tile có overlap.
5. Last row/column dùng kích thước phần còn lại, không pad.
6. `index = row * columnCount + column`.
7. Validate coverage: union tile phải phủ target, không gap > epsilon.

Unit tests gồm rectangle ngắn, exact multiple, remainder, target âm, target ngoài bounds, 2D tiling, fractional CSS coordinates.

## 13.4 Capture tile

Gọi `Page.captureScreenshot`:

```ts
{
  format: "png",
  fromSurface: true,
  captureBeyondViewport: true,
  optimizeForSpeed: true,
  clip: {
    x: tile.sourceRectCss.x,
    y: tile.sourceRectCss.y,
    width: tile.sourceRectCss.width,
    height: tile.sourceRectCss.height,
    scale: 1
  }
}
```

- Decode base64 ngay trong background thành bytes hoặc chuyển theo chunk nhỏ tới offscreen; không giữ nhiều tile base64 cùng lúc.
- Tối đa một capture command trên một tab tại một thời điểm.
- Retry tối đa 2 lần cho lỗi transient, backoff 250 ms và 750 ms.
- Nếu lỗi do kích thước, chia tile lỗi thành 2 tile nhỏ và cập nhật plan có revision.
- Sau lưu Blob thành công mới tăng `completedTiles`.

# 14. Scroll-and-capture fallback

Dùng `chrome.tabs.captureVisibleTab()`; rate limit tuyệt đối không vượt 2 calls/giây. Delay mặc định giữa hai lần gọi là 550 ms.

Algorithm document:

1. Lưu scroll position, viewport, styles và focus.
2. Đưa trang về target start.
3. Tính các scroll stop có overlap 64 CSS px.
4. Với mỗi stop:
   - scroll bằng `window.scrollTo` hoặc container scroll;
   - chờ 2 animation frame;
   - chờ layout settle;
   - ẩn/xử lý fixed elements theo policy;
   - chụp visible tab;
   - crop ngoài target viewport;
   - lưu tile và metadata overlap.
5. Offscreen processor cắt overlap theo expected coordinates.
6. Tile cuối crop phần dư.
7. Restore mọi trạng thái trong `finally`.

Fallback phải phát hiện:

- scroll không di chuyển;
- scroll snap;
- layout height thay đổi;
- fixed header/footer;
- zoom/DPR mismatch;
- tab mất active/focus.

Nếu tab không còn active, pause job và yêu cầu người dùng quay lại thay vì chụp tab khác.

# 15. Chuẩn bị và khôi phục trang

`PagePreparer.prepare()` trả `RestoreSnapshot` có version.

Snapshot tối thiểu:

- window scrollX/scrollY;
- active element selector/path an toàn;
- documentElement/body inline style bị sửa;
- danh sách element fixed/sticky bị sửa và original style attribute;
- container scroll offsets;
- injected style element ID;
- CSS scroll behavior;
- animation/transition state;
- caret color và selection nếu thay đổi.

CSS freeze dùng một style element duy nhất có prefix `webcap-`:

```css
*, *::before, *::after {
  animation-play-state: paused !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
```

Không blanket-disable transition nếu làm thay đổi layout; chỉ disable trong fallback khi cần và test fixture xác nhận.

Restore:

- idempotent;
- chạy khi success, error, cancel, tab navigation và extension shutdown best-effort;
- không ghi đè thay đổi mới của trang nếu giá trị hiện tại không còn khớp giá trị WebCap đã set; dùng compare-before-restore.

# 16. Lazy-load và infinite scroll

Pre-scroll policy:

1. Bắt đầu tại đầu target.
2. Scroll theo 0,8 viewport.
3. Sau mỗi step chờ `settleMs` và theo dõi:
   - document/target height;
   - pending image decode best-effort;
   - mutation count;
   - network idle không bắt buộc vì content script không có network visibility đầy đủ.
4. Dừng khi height ổn định 3 lần liên tiếp hoặc đạt max duration.
5. Đo lại trang.
6. Quay về vị trí start trước capture.

Infinite scroll guard:

- dừng tại max height, max tiles, max duration hoặc user cancel;
- UI phải nói rõ capture là “đến giới hạn”;
- phần đã chụp vẫn export được;
- không tự động scroll vô hạn.

# 17. Fixed/sticky policy

- `preserve`: không sửa; phù hợp CDP single surface nhưng có thể lặp ở fallback.
- `remove`: ẩn mọi element có computed `position: fixed|sticky` được phát hiện trong target.
- `smart`:
  - fixed/sticky ở top được giữ tile đầu, ẩn tile sau;
  - fixed footer được giữ tile cuối, ẩn tile trước;
  - element nằm giữa trang được preserve trừ khi visual test chứng minh lặp;
  - detection dùng rect, z-index, visible area và intersection với viewport edge.

Mọi element sửa phải có restore record. Không gắn class chung có thể xung đột với site; dùng data attribute có namespace và inline style được snapshot.

# 18. Region selector

Overlay nằm trong một root element fixed, z-index cao, Shadow DOM closed/open theo benchmark nhưng CSS phải cô lập.

Features M3:

- drag tạo rect;
- resize 8 handles;
- move rect;
- tooltip width × height;
- Esc cancel, Enter confirm;
- arrow nudge 1 px; Shift + arrow 10 px;
- auto-scroll khi pointer gần viewport edge;
- rect lưu document coordinates;
- overlay bị remove trước capture và chờ ít nhất 2 animation frame.

Coordinate formula:

```ts
const documentX = clientX + window.scrollX;
const documentY = clientY + window.scrollY;
```

Phải tính visual viewport offset trên thiết bị/zoom có khác biệt. Tất cả conversion đi qua `CoordinateSpace` module.

# 19. Element selector

- Lấy candidates bằng `elementsFromPoint()`.
- Bỏ qua root/overlay của WebCap.
- Highlight `getBoundingClientRect()`.
- Convert sang document coordinates.
- Up chọn parent hợp lệ; Down quay lại child đã chọn trước đó.
- Hiển thị tag, id/class rút gọn và kích thước; sanitize text.
- Với shadow DOM, ưu tiên `event.composedPath()`.
- Nếu element là scroll container, UI cho hai lựa chọn: visible bounds hoặc full scroll content.
- Element biến mất trước capture trả `E_TARGET_STALE`, cho chọn lại.

# 20. Scrollable container

Một element là candidate khi:

```ts
const style = getComputedStyle(element);
const overflowX = style.overflowX;
const overflowY = style.overflowY;
const canScrollX = /auto|scroll/.test(overflowX) && element.scrollWidth > element.clientWidth + 1;
const canScrollY = /auto|scroll/.test(overflowY) && element.scrollHeight > element.clientHeight + 1;
```

Capture container fallback:

- snapshot scrollTop/scrollLeft;
- tile theo clientWidth/clientHeight với overlap;
- capture visible tab rồi crop container rect;
- nếu sticky child lặp, áp dụng policy cục bộ;
- restore scroll và styles.

CDP clip có thể chụp bounding rect ngoài viewport nhưng không tự render toàn bộ nội dung bị clip bên trong scroll container. Vì vậy full scroll-area dùng scroll engine trừ khi prototype chứng minh CDP DOM manipulation an toàn.

# 21. Image processing

Offscreen processor nhận tile key, đọc Blob từ IndexedDB và:

- decode bằng `createImageBitmap` khi hỗ trợ;
- crop overlap/edge bằng `OffscreenCanvas` hoặc canvas trong offscreen document;
- encode theo output format;
- giải phóng bitmap bằng `close()`;
- revoke object URL;
- không giữ quá 2 decoded tile cùng lúc.

PNG full-page image chỉ tạo khi kích thước output nằm dưới guardrail của browser. Nếu vượt:

- đề xuất PDF;
- hoặc xuất nhiều ảnh segment;
- không cố tạo canvas cực dài.

Thumbnail có max cạnh 320 px, JPEG/WebP quality thấp hợp lý, lưu riêng để editor không decode tile gốc liên tục.

# 22. PDF exporter

## 22.1 Đơn vị

PDF dùng point; `1 inch = 72 pt`, `1 inch = 25,4 mm`.

```ts
const mmToPt = (mm: number) => (mm / 25.4) * 72;
```

## 22.2 Page slicing

Với page cố định:

```ts
printableWidthPt = pageWidthPt - leftMarginPt - rightMarginPt;
printableHeightPt = pageHeightPt - topMarginPt - bottomMarginPt;
scale = printableWidthPt / imageWidthPx;
sourceHeightPxPerPage = printableHeightPt / scale;
```

Exporter phải crop theo source rect liên tục, tránh round mỗi page làm tích lũy gap. Dùng running floating offset, chỉ round tại pixel crop boundary và carry phần dư.

## 22.3 Pipeline

1. Đọc metadata tile theo thứ tự.
2. Xác định logical canvas coordinate nhưng không tạo canvas tổng.
3. Với mỗi PDF page, xác định các tile intersect page source rect.
4. Crop các phần cần thiết; có thể tạo canvas chỉ bằng kích thước một page.
5. Encode page image JPEG theo quality.
6. Embed vào PDF page.
7. Sau page add, giải phóng canvas/bitmap.
8. Lưu artifact Blob vào IndexedDB.
9. Download qua object URL và `chrome.downloads.download()`.

M4 cần benchmark `pdf-lib` với 10k, 30k và 100k px. Nếu peak memory không đạt NFR, tạo ADR thay đổi library hoặc pipeline.

# 23. Download và filename

Filename mặc định:

```text
{sanitized-title}_{domain}_{yyyy-MM-dd_HH-mm-ss}.{ext}
```

Quy tắc sanitize:

- Unicode normalize NFKC;
- bỏ ký tự control và `<>:"/\\|?*`;
- collapse whitespace/dash;
- trim dot/space cuối;
- giới hạn base name 120 ký tự;
- fallback `webcap-capture`;
- path truyền cho downloads là relative, không chứa `..`.

Blob URL chỉ tồn tại đến khi download được bắt đầu; revoke sau khi Chrome đã nhận download hoặc sau timeout an toàn.

# 24. Error model

```ts
export interface WebCapErrorData {
  code: WebCapErrorCode;
  stage: "permission" | "prepare" | "measure" | "plan" | "capture" | "process" | "export" | "cleanup";
  message: string;
  userMessageKey: string;
  retryable: boolean;
  fallbackAllowed: boolean;
  safeContext?: Record<string, string | number | boolean>;
  causeCode?: string;
}
```

Mã tối thiểu:

- `E_PERMISSION_DENIED`
- `E_UNSUPPORTED_URL`
- `E_TAB_NOT_ACTIVE`
- `E_DEBUGGER_ATTACH`
- `E_DEBUGGER_DETACHED`
- `E_CDP_COMMAND`
- `E_LAYOUT_UNSTABLE`
- `E_TARGET_STALE`
- `E_TILE_PLAN`
- `E_CAPTURE_RATE_LIMIT`
- `E_CAPTURE_EMPTY`
- `E_STORAGE_QUOTA`
- `E_MEMORY_GUARD`
- `E_OFFSCREEN_UNAVAILABLE`
- `E_EXPORT_FAILED`
- `E_DOWNLOAD_FAILED`
- `E_CANCELLED`
- `E_CLEANUP_PARTIAL`
- `E_PROTOCOL_VERSION`

Không log full URL, DOM text, image data, cookie, token hoặc base64.

# 25. Logging và diagnostics

Logger có level `debug|info|warn|error`, mặc định production là `warn`.

Log fields an toàn:

- timestamp;
- extension version;
- jobId rút gọn;
- mode/engine/stage;
- tile index/count;
- duration bucket;
- error code;
- Chrome version bucket.

Có nút “Sao chép thông tin chẩn đoán” xuất JSON đã redaction, không chứa nội dung trang.

# 26. UI scope theo milestone

## M0 Popup shell

- logo/name;
- tab capability status;
- 5 mode button ở trạng thái disabled/enabled theo feature flag;
- format selector;
- start button;
- settings link.

## M1 Preview tối thiểu

- một thumbnail;
- dimensions/file estimate;
- download button;
- retry/cancel.

## M2 Progress

- stage label;
- completed/total;
- progress bar;
- cancel;
- fallback prompt khi CDP lỗi.

## M3 Selector overlay

- region/element modes;
- keyboard help ngắn;
- confirm/cancel floating controls.

## M4 Editor

- page thumbnails;
- remove/reorder;
- PDF settings;
- export.

UI chưa có implementation/test không được hiện bằng nút giả. Dùng feature flag compile-time hoặc capability response.

# 27. Test strategy

## 27.1 Unit

Bắt buộc cho:

- tile planner;
- coordinate conversion;
- overlap resolver;
- state transitions;
- filename sanitizer;
- PDF page slicing;
- settings validation/migration;
- error normalization;
- cleanup comparison logic.

Coverage target ban đầu: 80% statements cho pure modules; không dùng coverage để thay thế test case quan trọng.

## 27.2 Integration

Mock Chrome API typed adapter, kiểm thử:

- create/cancel/retry job;
- debugger attach/detach mọi exit path;
- service worker restart và restore job summary;
- offscreen handshake race;
- IndexedDB transaction failure;
- export retry không capture lại;
- duplicate message idempotency.

## 27.3 E2E

Playwright launch persistent Chromium context với extension unpacked. Fixture server local, không phụ thuộc internet.

Fixture bắt buộc:

```text
normal-long-page
lazy-images
infinite-scroll
sticky-header
fixed-header-footer
nested-scroll
wide-table
iframe-same-origin
iframe-cross-origin
canvas
webgl
shadow-dom
animated-page
layout-shift
scroll-snap
pdf-multipage
```

## 27.4 Visual regression

- Golden image theo fixture, DPR và zoom quan trọng.
- Diff threshold thấp; mask chỉ vùng thật sự nondeterministic.
- Không update golden hàng loạt nếu chưa review hình ảnh.

## 27.5 Performance

Benchmark:

- 10.000, 30.000 và 100.000 CSS px;
- width 1440 và wide table;
- output PNG/JPEG/PDF;
- record duration, peak JS heap best-effort, tile bytes và artifact size.

# 28. CI

GitHub Actions `ci.yml` chạy:

1. checkout;
2. setup Node + pnpm cache;
3. `pnpm install --frozen-lockfile`;
4. `pnpm lint`;
5. `pnpm typecheck`;
6. `pnpm test:unit --run`;
7. `pnpm build`;
8. E2E smoke trên Linux khi M1 hoàn thành;
9. upload extension ZIP/test report khi tag hoặc manual workflow.

Không merge nếu lint, typecheck, unit hoặc build fail.

# 29. Commands chuẩn

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings=0",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed",
    "package": "node scripts/package-extension.mjs"
  }
}
```

# 30. Milestone implementation plan

## M0 — Foundation

Tasks:

- bootstrap pnpm/Vite/React/TypeScript;
- manifest và multi-entry build;
- popup shell;
- service worker shell;
- shared contracts/Zod;
- settings repository;
- logger/error/result;
- Vitest/ESLint/Prettier;
- CI;
- README build/load-unpacked.

Exit:

- `pnpm install`, lint, typecheck, unit, build pass;
- extension load unpacked;
- popup gửi ping tới service worker;
- không có permission ngoài spec.

## M1 — Visible capture

Tasks:

- active tab capability;
- `captureVisibleTab` adapter;
- offscreen Blob/image processing;
- artifact storage;
- preview/download PNG/JPEG/WebP;
- filename sanitizer;
- smoke fixture/E2E.

Exit: AC-01, AC-17 cho ảnh.

## M2 — Full-page CDP

Tasks:

- debugger client;
- page metrics;
- tile planner 2D;
- page prepare/restore;
- CDP capture loop;
- job coordinator/state storage;
- progress/cancel;
- smart fixed prototype;
- scroll fallback cơ bản;
- long-page fixtures/benchmarks.

Exit: AC-02, AC-03, AC-06, AC-10, AC-11.

## M3 — Region và element

Tasks:

- isolated overlay root;
- region drag/resize/autoscroll;
- coordinate module;
- element inspector/parent-child;
- target stale handling;
- capture target rect;
- accessibility keyboard.

Exit: AC-07, AC-08.

## M4 — PDF export/editor

Tasks:

- page slicing math;
- page-at-a-time renderer;
- pdf-lib benchmark;
- editor thumbnails/remove/reorder;
- A4/Letter/fit-width;
- export retry;
- download integrity tests.

Exit: AC-12, AC-13, AC-17 cho PDF.

## M5 — Scroll area và PDF source

Tasks:

- scroll container detection;
- container tiling/crop;
- sticky child handling;
- PDF URL detection;
- original passthrough khi an toàn;
- PDF.js viewer chỉ sau prototype và ADR nếu cần.

Exit: AC-09 và PDF source smoke.

## M6 — Hardening/store

Tasks:

- lazy/infinite policy;
- zoom/DPR matrix;
- iframe/canvas/WebGL cases;
- diagnostics;
- i18n vi/en;
- privacy/permission copy;
- packaged test;
- store assets/checklist.

Exit: toàn bộ MUST acceptance criteria; không P0/P1.

# 31. Commit và PR policy

- Branch: `agent/<milestone>-<scope>`.
- Commit nhỏ, imperative, ví dụ `Implement tile planner`.
- Không commit generated `dist/`, browser profile, downloaded test files hoặc large golden không được duyệt.
- Mỗi PR ghi: mục tiêu, thay đổi, test đã chạy, screenshot/video nếu UI, risk và rollback.
- Không trộn refactor không liên quan với feature.
- Nếu sửa interface trong mục 7–12, cập nhật tests và spec/ADR trong cùng PR.

# 32. Definition of Done cho một task

Task chỉ hoàn thành khi:

- behavior khớp PRD và SPEC;
- types không dùng `any` trừ adapter có comment;
- lỗi được normalize;
- cleanup được xử lý;
- unit/integration/E2E phù hợp đã thêm;
- lint/typecheck/test/build pass;
- không thêm permission/dependency ngoài dự kiến;
- docs/changelog cập nhật nếu user-facing;
- không log dữ liệu nhạy cảm.

# 33. Những điều không được làm

- Không ghép ảnh 100.000 px vào một canvas duy nhất.
- Không lưu tile base64 trong `chrome.storage`.
- Không giữ debugger attach khi người dùng đang preview.
- Không inject remote script hoặc dùng CDN.
- Không dùng `setTimeout` tùy tiện thay cho settle/rate-limit abstraction.
- Không sửa DOM mà không có restore snapshot.
- Không bắt lỗi rồi bỏ qua im lặng.
- Không thêm `<all_urls>` mặc định.
- Không thu full URL/title/image vào analytics.
- Không làm UI hứa tính năng chưa triển khai.

# 34. Open technical validations

Các mục sau cần prototype nhưng đã có lựa chọn mặc định:

| ID | Validation | Mốc | Default nếu chưa có bằng chứng khác |
| --- | --- | --- | --- |
| TV-01 | Maximum safe CDP tile area theo DPR/GPU | M2 | 8192 × 8192 CSS px với dynamic split. |
| TV-02 | `pdf-lib` peak memory trên 100k page | M4 | Page-at-a-time JPEG embedding. |
| TV-03 | Offscreen reasons phù hợp nhất | M1 | `BLOBS`; thêm `WORKERS` khi worker thực sự dùng. |
| TV-04 | Shadow root open hay closed cho overlay | M3 | open để test/debug, CSS namespace chặt. |
| TV-05 | Smart fixed classification | M2 | top/header first tile, footer last tile. |
| TV-06 | Direct CDP capture của scroll container | M5 | Không dùng; scroll + visible crop. |

Mỗi validation phải có benchmark/test fixture và ADR nếu đổi default.

# 35. Thứ tự công việc tiếp theo

Lần triển khai kế tiếp bắt đầu tại **M0 — Foundation**, theo thứ tự commit đề xuất:

1. `Bootstrap TypeScript extension workspace`.
2. `Add Manifest V3 multi-entry build`.
3. `Define shared message and error contracts`.
4. `Add service worker and popup handshake`.
5. `Add settings repository and validation`.
6. `Configure lint, test, build, and CI`.
7. `Document local development workflow`.

Không bắt đầu capture engine trước khi M0 exit criteria pass.

# 36. Tài liệu tham chiếu chính thức

- Chrome Extensions overview: https://developer.chrome.com/docs/extensions/
- Manifest V3: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- `chrome.debugger`: https://developer.chrome.com/docs/extensions/reference/api/debugger
- `chrome.offscreen`: https://developer.chrome.com/docs/extensions/reference/api/offscreen
- `chrome.runtime`: https://developer.chrome.com/docs/extensions/reference/api/runtime
- `chrome.scripting`: https://developer.chrome.com/docs/extensions/reference/api/scripting
- `chrome.tabs`: https://developer.chrome.com/docs/extensions/reference/api/tabs
- `chrome.storage`: https://developer.chrome.com/docs/extensions/reference/api/storage
- `chrome.downloads`: https://developer.chrome.com/docs/extensions/reference/api/downloads
- CDP Page domain: https://chromedevtools.github.io/devtools-protocol/tot/Page/

Tài liệu chính thức là nguồn ưu tiên khi hành vi API thay đổi. Trước khi dùng API mới hoặc thay đổi minimum Chrome, phải kiểm tra lại tài liệu hiện hành và cập nhật ADR/spec.
