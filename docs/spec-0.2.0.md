---
product: WebCap
document: Engineering Specification Addendum
version: 0.2.0
date: 2026-08-04
status: Approved for implementation planning
repository: quoctran-2608/WebCap
extends: ../SPEC.md
prd: ../PRD_WebCap_v1.1.md
audit: ./audits/0.1.0-gap-audit.md
---

# WebCap 0.2.0 — Engineering Specification Addendum

Đặc tả này mở rộng `SPEC.md` 0.1.0. Manifest V3, TypeScript strict, local-first, IndexedDB Blob storage, metadata-only messages, offscreen processing, page-at-a-time PDF và không remote executable code vẫn giữ nguyên.

# 1. Quyết định kiến trúc mới

| ID       | Quyết định                                                  | Lý do                                                                               |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ADR-0015 | Auto-scroll dùng adaptive capture frontier                  | Document height có thể tăng sau mỗi lần cuộn.                                       |
| ADR-0016 | Stable end cần bottom + nhiều vòng ổn định + final probe    | `scrollHeight` đơn lẻ không chứng minh đã hết nội dung.                             |
| ADR-0017 | Auto-PDF là completion policy mặc định của full-page        | Editor không còn là bước bắt buộc.                                                  |
| ADR-0018 | Reset là domain command                                     | Phải cleanup job/tile/artifact/session/lock nhất quán.                              |
| ADR-0019 | Popup dùng progressive disclosure                           | Technical data không cạnh tranh với CTA.                                            |
| ADR-0020 | Region selector dùng ready handshake trước khi đóng popup   | Tránh người dùng bấm nhưng không thấy overlay và tránh orphan job.                  |
| ADR-0021 | Settings repository là nguồn sự thật của job                | Không tạo capture từ hard-coded defaults khi đã có lựa chọn lưu.                    |
| ADR-0022 | Progress ưu tiên event, polling chỉ reconciliation fallback | Giảm request liên tục và đơn giản hóa UI state.                                     |
| ADR-0023 | Output policy theo mode                                     | Region/element cần ảnh trực tiếp; full-page cần PDF; unsafe image phải fallback rõ. |
| ADR-0024 | Adaptive capture có resumable frontier                      | Long job không nên mất prefix đã lưu khi worker restart.                            |

# 2. Baseline và khoảng trống cần đóng

0.1.0 đã có region overlay hỗ trợ pointer create/move/resize, tám handle, auto-scroll, Enter/Escape và overlay removal trước capture. Tuy nhiên popup handler chỉ tạo job/set local state và không đóng popup sau selector-ready ACK. Vì vậy implementation tồn tại nhưng hành trình người dùng không được đảm bảo.

Các khoảng trống khác:

- scroll fallback clamp theo `maxCssHeight`, pre-plan tile và fail khi layout height thay đổi;
- tiled job không có reset command;
- `startTiledCapture()` dùng `DEFAULT_CAPTURE_SETTINGS` thay vì stored settings;
- region/element/scroll-area không có output routing trực tiếp rõ ràng;
- popup polling trạng thái theo chu kỳ ngắn;
- active job restart chuyển failed thay vì resume/keep-partial flow;
- basic crop, original-PDF page range và one-long-page PDF chưa có, được defer trừ khi core sessions hoàn tất sớm.

# 3. Region selector launch và interaction

## 3.1 Ready handshake

Mở rộng protocol:

```ts
interface RegionSelectionReadyPayload {
  jobId: string;
  selectorInstanceId: string;
  readyAt: string;
  capabilities: {
    pointerCreate: true;
    keyboardCreate: true;
    autoScroll: true;
    resizeHandles: 8;
  };
}
```

`REGION_SELECTION_OPEN` chỉ ACK success sau khi:

1. content script đã inject;
2. selector root gắn vào `document.documentElement`;
3. Shadow DOM stage tồn tại;
4. stage focus thành công;
5. pointer/keyboard listeners đã đăng ký;
6. một animation frame đã render overlay.

Popup gọi `window.close()` sau ready ACK. Không close trước ACK để lỗi injection vẫn hiển thị được. Timeout mặc định `2_000 ms`; timeout/error phải gọi cancellation/reset cleanup và không để job/root/lock tồn tại.

## 3.2 Selector UX

Selector phải có:

- dim mask và `cursor: crosshair` rõ trên toàn viewport;
- toolbar ngắn: “Kéo để vẽ vùng cần chụp · Enter xác nhận · Esc hủy”;
- rectangle vàng/brand accent, dimensions live region;
- move body và tám resize handles;
- hit target mỗi handle tối thiểu 24×24 CSS px; visual dot có thể 12 px;
- auto-scroll theo cả X/Y khi pointer sát edge;
- no global styles/classes ngoài namespaced root.

## 3.3 Keyboard model

- `Space` khi chưa có rect: tạo centered rect, width `min(480, 50vw)`, height `min(320, 40vh)`, clamp vào document.
- Arrow: move 1 CSS px.
- Shift+Arrow: move 10 CSS px.
- Alt+Arrow: resize edge theo hướng 1 CSS px.
- Alt+Shift+Arrow: resize 10 CSS px.
- Enter: commit khi rect hợp lệ.
- Escape: cancel.

Nếu browser/OS chiếm Alt+Arrow, toolbar có button “Tạo vùng bằng bàn phím” và controls tăng/giảm width/height làm fallback accessible.

## 3.4 Commit/cancel invariants

- Region lưu bằng CSS document coordinates.
- Root bị remove trước capture; chờ ít nhất hai RAF.
- Overlay pixels không được xuất hiện trong tile.
- Cancel/launch failure phục hồi original scroll/focus và xóa job khi chưa có tile.
- Duplicate open cho cùng job trả cùng selector instance hoặc thay thế atomically; không có hai roots.

# 4. Adaptive auto-scroll engine

## 4.1 Modules

```text
src/capture/adaptive-scroll-capture-engine.ts
src/capture/adaptive-frontier-planner.ts
src/capture/stable-end-detector.ts
src/background/adaptive-resume-service.ts
```

`ScrollCaptureEngine` cũ giữ vai trò deterministic fallback cho target có kích thước đã biết. Adaptive engine dùng chung page adapter, rate limiter, crop/overlap, fixed/sticky và tile repository.

## 4.2 Frontier

```ts
interface AdaptiveCaptureFrontier {
  schemaVersion: 1;
  nextYCss: number;
  capturedBottomCss: number;
  observedDocumentHeightCss: number;
  stableBottomRounds: number;
  capturedRows: number;
  storedBytes: number;
  startedAt: string;
  lastGrowthAt: string;
  sourceDocumentToken: string;
  viewportWidthCss: number;
  viewportHeightCss: number;
  devicePixelRatio: number;
}
```

Quy tắc:

1. Full-document bắt đầu tại `y=0`.
2. Capture một row, persist Blob, rồi mới advance frontier.
3. Remeasure height/max scroll sau mỗi settle.
4. Height growth là expected; width/DPR/pixel-scale drift là lỗi.
5. Prefix không được recapture khi height tăng hoặc resume.
6. `logicalOutputRectCss` phải tạo contiguous coverage.
7. Final viewport crop chạm đúng observed bottom.

## 4.3 Stable-end detector

Complete khi đồng thời:

- `actualScrollY + viewportHeight >= maxScrollY - epsilon`;
- height không tăng tối thiểu 3 settle rounds;
- không có pending mutation/resize/image growth trong window;
- final tile đã persist và logical bottom chạm document bottom;
- final probe scroll-to-bottom không phát hiện growth.

Hằng số đề xuất:

```ts
AUTO_SCROLL_STABLE_ROUNDS = 3;
AUTO_SCROLL_BOTTOM_EPSILON_CSS = 2;
AUTO_SCROLL_GROWTH_SETTLE_MS = 500;
AUTO_SCROLL_FINAL_PROBE_MS = 750;
```

## 4.4 Guardrails

Adaptive mode không dùng 100.000 CSS px làm hard stop. Partial reasons:

```ts
type AdaptiveStopReason =
  | "stable-end"
  | "user-stop"
  | "max-duration"
  | "max-stored-bytes"
  | "max-tiles"
  | "storage-pressure"
  | "page-never-stabilized"
  | "source-document-changed";
```

Budget ban đầu để benchmark: 20 phút, 2.000 tile, nhỏ hơn 1 GiB hoặc quota còn lại. Không thêm `unlimitedStorage` nếu chưa có ADR và permission review.

## 4.5 Resume sau service-worker restart

Sau mỗi stored tile, persist frontier và opaque `sourceDocumentToken`. Recovery:

1. query active tab và content runtime;
2. revalidate same tab/document token, viewport width, DPR và compatible page state;
3. re-prepare page, scroll đến `nextYCss`, verify boundary fingerprint/coordinate;
4. resume từ frontier nếu valid;
5. nếu invalid, settle job thành retryable partial với Keep/Restart/Reset.

Không auto-resume nếu tab navigated, document token đổi hoặc pixel geometry không tương thích. Resume idempotent và không tạo duplicate tile index/output rect.

# 5. Auto-PDF và mode-aware output

## 5.1 Completion policy

```ts
interface CaptureCompletionPolicy {
  primaryOutput: "png" | "jpeg" | "webp" | "pdf";
  autoExport: boolean;
  openEditorAfterCapture: boolean;
  allowGuardedImageFallback: boolean;
}
```

Defaults:

- full-page: PDF, auto export;
- scroll-area: PDF, auto export, guarded image option;
- region: PNG, auto export, PDF fallback;
- element: PNG, auto export, PDF fallback;
- visible: existing image flow.

## 5.2 PDF exporter

State:

```text
created → preparing → capturing → processing → ready → exporting → completed
```

`ready` là durable checkpoint. Auto-export từ `ready` phải idempotent. PDF invariants:

- consume logical output/crop/overlap metadata;
- reject gap/duplicate/negative crop;
- one page canvas at a time;
- decoded tile concurrency ≤ 1;
- exact final source bottom;
- partial metadata rõ ràng;
- no full-page canvas.

## 5.3 Guarded tiled image exporter

Thêm `TiledImageExportService` cho region/element và scroll-area nhỏ:

- chỉ allocate output canvas sau pixel/memory/canvas-dimension guard;
- decode sequentially;
- apply crop/overlap metadata;
- PNG/JPEG/WebP output;
- nếu vượt guard, trả typed recommendation `E_IMAGE_OUTPUT_TOO_LARGE` với CTA “Xuất PDF”.

Không cố ghép long image vượt browser canvas limit.

# 6. Reset domain command

Contract:

```ts
type CaptureResetScope = "visible-session" | "job" | "tab";

interface CaptureResetRequest {
  type: "CAPTURE_RESET";
  protocolVersion: 1;
  requestId: string;
  source: "popup" | "editor";
  target: "background";
  payload: {
    scope: CaptureResetScope;
    tabId?: number;
    jobId?: string;
    disposition: "discard-local-data";
  };
}
```

`CaptureResetService` là nơi duy nhất orchestration cleanup. Terminal reset: delete editor manifest/thumbnails → artifacts → tiles → job → summary → stale lock. Active reset: mark discard intent → cancel/restore → delete. Missing record success idempotent. Response chỉ có counts/warnings, không binary/URL.

Expiry cleanup reuse cùng primitive. Settings/locale/downloaded files không bị xóa. “Đặt lại tùy chọn” dùng command riêng.

# 7. Settings source of truth

- Popup load settings repository trước khi tạo job.
- `startTiledCapture` nhận full validated settings, không import `DEFAULT_CAPTURE_SETTINGS` để override user choice.
- Settings schema bump nếu thêm completion policy/per-mode output.
- Migration 0.1.0 giữ locale và existing values; thêm defaults mới theo mode.
- Persist: image format/quality, PDF size/orientation/margin/quality, fixed/sticky mode, completion policy.
- Resource budgets chỉ nằm trong advanced/internal settings có validation; không expose raw unlimited values.

# 8. Event-driven popup architecture

## 8.1 Events

Background phát versioned events:

```text
JOB_PROGRESS
JOB_STATE_CHANGED
VISIBLE_SESSION_CHANGED
CAPTURE_RESET_COMPLETED
SELECTOR_STATE_CHANGED
```

Popup subscribe khi mở. Event chỉ metadata. Popup fetch authoritative job khi:

- initial open;
- event revision bị skip;
- reconnect after worker restart;
- reconciliation timer 5–10 giây trong busy state.

Không polling 350 ms liên tục.

## 8.2 Information architecture

```text
Header + help
Conditional support/permission notice
Goal selector:
  Full page → PDF
  Specific area
  Current screen
Target picker when Specific area:
  Draw rectangle
  Select element
  Select scroll area
Primary CTA
Phase progress/result
Advanced options
Help & diagnostics
```

Ẩn khỏi main flow: worker/version, engine, raw tile count, checksum, milestones, full permissions, diagnostics. PDF source inspection không block main UI và không render checking card trên non-PDF tab.

# 9. Test strategy

## 9.1 Region selection

- unit: coordinate create/move/resize, keyboard model, ready handshake, timeout cleanup;
- E2E from real action popup: click Draw region → popup closes → overlay visible ≤500 ms;
- pointer create/move/eight handles/auto-scroll;
- keyboard-only create/move/resize/confirm/cancel;
- overlay exclusion, focus/scroll restoration, duplicate open, launch failure;
- DPR/zoom critical matrix.

## 9.2 Adaptive/resume

- stable detector static/delayed/repeated/never stable;
- frontier monotonicity and no duplicate after resume;
- actual browser static 30k, 100k, >100k;
- finite lazy growth and infinite guard;
- restart after N tiles: resume or partial disposition;
- width/DPR/document change negatives.

## 9.3 Output/settings/UI

- auto-PDF restart at `ready` exactly once;
- seam integrity pattern detects missing/duplicate strips;
- guarded image export success/fallback;
- settings persistence/migration/reset defaults;
- event delivery and skipped revision reconciliation;
- default popup excludes technical copy; help remains keyboard accessible.

## 9.4 Release gate

S26 chạy:

- format/lint/strict typecheck;
- privacy/dependency/release/security audits;
- all unit/PDF benchmarks/E2E;
- DPR 1/1.5/2 × zoom 80/100/125/150 critical flows;
- minimum Chrome, current stable và previous stable;
- Linux/Windows/macOS packaged lifecycle;
- deterministic ZIP;
- acceptance AC-01–AC-40.

# 10. Deferred và platform boundaries

Không cố “fix” bằng workaround nguy hiểm:

- restricted browser surfaces;
- DRM/protected overlays;
- cross-origin frame DOM và closed shadow roots;
- optional permission/file policy;
- source tab active requirement của `captureVisibleTab` engines;
- device/font/GPU pixel variance.

Deferred sau 0.2.0: advanced crop, original PDF page ranges, one-long-page PDF, annotation/OCR, batch, cloud integrations và capture library.

# 11. Rollback

- S21 reset độc lập.
- S22 region selector launch độc lập.
- S23 adaptive/resume sau feature flag nội bộ.
- S24 auto-export/output policy có thể tắt mà giữ tiles.
- S25 UI/settings có thể rollback presentation, không rollback contracts.
- Không package/upload 0.2.0 trước S26 gate và approval riêng.
