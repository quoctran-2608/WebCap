---
product: WebCap
document: Engineering Specification Addendum
version: 0.2.0
date: 2026-08-04
status: Approved for implementation planning
repository: quoctran-2608/WebCap
extends: ../SPEC.md
prd: ../PRD_WebCap_v1.1.md
---

# WebCap 0.2.0 — Engineering Specification Addendum

Đặc tả này mở rộng `SPEC.md` của 0.1.0. Các quyết định Manifest V3, TypeScript strict, local-first, IndexedDB Blob storage, metadata-only runtime messages, offscreen processing, page-at-a-time PDF và không remote executable code vẫn giữ nguyên.

# 1. Quyết định kiến trúc mới

| ID | Quyết định | Lý do |
| --- | --- | --- |
| ADR-0015 | Auto-scroll dùng adaptive capture frontier | Chiều cao trang có thể tăng khi cuộn; pre-plan toàn bộ từ một phép đo ban đầu không đủ đúng. |
| ADR-0016 | “Đến cuối trang” dùng stable-end detector | `scrollHeight` đơn lẻ không chứng minh trang đã tải xong; cần đáy trang + nhiều vòng ổn định. |
| ADR-0017 | Auto-PDF là orchestration mặc định sau tiled capture | Người dùng phổ thông không phải mở editor để hoàn tất tác vụ cơ bản. |
| ADR-0018 | Reset là domain command, không chỉ là reset React state | Phải xóa job, tile, artifact, editor manifest, thumbnail, summary và lock một cách nhất quán. |
| ADR-0019 | Popup dùng progressive disclosure | Thông tin kỹ thuật vẫn tồn tại cho support nhưng không cạnh tranh với hành động chính. |

# 2. Hiện trạng cần thay đổi

`ScrollCaptureEngine` hiện đo trang một lần, clamp target theo `maxCssHeight`, lập toàn bộ tile plan và coi `layoutChanged` là lỗi. Cách này phù hợp fallback của trang tĩnh nhưng không phù hợp auto-scroll qua lazy-growth. Popup hiện vô hiệu hóa start khi tiled job ở `ready/completed`, trong khi không có reset command cho persistent job. PDF export đã có nhưng luồng chính yêu cầu người dùng mở editor sau khi capture đạt `ready`.

0.2.0 không thay thế CDP engine. “Toàn trang → PDF” vẫn ưu tiên CDP cho trang tĩnh khi nó chứng minh được complete capture; adaptive scroll là đường chính khi trang cần user-visible scrolling, lazy growth hoặc CDP không đáp ứng capability.

# 3. Adaptive auto-scroll engine

## 3.1 Tách engine

Không mở rộng `ScrollCaptureEngine` hiện tại bằng nhiều nhánh điều kiện. Thêm engine mới:

```text
src/capture/adaptive-scroll-capture-engine.ts
src/capture/adaptive-frontier-planner.ts
src/capture/stable-end-detector.ts
```

- `ScrollCaptureEngine` tiếp tục là deterministic fallback cho target có kích thước đã biết.
- `AdaptiveScrollCaptureEngine` phục vụ full-document auto-scroll đến stable end.
- Cả hai dùng chung page adapter, rate limiter, crop/overlap primitives, tile repository và fixed/sticky policy.

## 3.2 Capture frontier

Engine không tạo toàn bộ tile plan trước. Nó lưu frontier tăng đơn điệu:

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
}
```

Quy tắc:

1. Bắt đầu từ `y = 0` đối với full-document mode, không từ scroll hiện tại.
2. Chụp viewport với overlap cố định và ghi `logicalOutputRectCss` sao cho output là contiguous prefix.
3. Chỉ tăng `capturedBottomCss` sau khi Blob của tile đã được persist thành công.
4. Sau mỗi tile, đo lại document height và max scroll.
5. Nếu height tăng, giữ các tile đã lưu và tiếp tục từ frontier; không chụp lại prefix.
6. Nếu viewport cuối ngắn hơn, crop theo logical bottom thực tế.
7. Không lưu một row gây gap hoặc overlap logic ngoài crop metadata.

Frontier phải được persist trong `CaptureJob` hoặc record versioned riêng để service-worker restart có thể đánh dấu job retryable/partial một cách trung thực. 0.2.0 không yêu cầu resume capture tự động sau browser restart giữa tile; nhưng dữ liệu đã persist phải vẫn có thể giữ hoặc reset.

## 3.3 Stable-end detector

Kết thúc hoàn chỉnh khi tất cả điều kiện đúng:

- `actualScrollY + viewportHeight >= maxScrollY - epsilon`;
- document height không tăng trong tối thiểu `3` vòng settle liên tiếp;
- không có pending layout growth được page adapter quan sát trong settle window;
- tile cuối đã được persist và logical output chạm observed document bottom;
- detector đã thực hiện một probe scroll-to-bottom cuối cùng sau vòng ổn định thứ hai.

Giá trị mặc định dự kiến:

```ts
AUTO_SCROLL_STABLE_ROUNDS = 3
AUTO_SCROLL_BOTTOM_EPSILON_CSS = 2
AUTO_SCROLL_GROWTH_SETTLE_MS = 500
AUTO_SCROLL_FINAL_PROBE_MS = 750
```

Các hằng số phải nằm trong `src/shared/constants.ts`, có unit test và có thể được điều chỉnh qua internal settings schema; không hard-code trong engine.

## 3.4 Guardrails

Bỏ `DEFAULT_MAX_CSS_HEIGHT = 100_000` khỏi vai trò chặn mặc định của auto-scroll. Không được đổi thành “không giới hạn” theo nghĩa bỏ mọi guard.

Auto-scroll dừng partial với machine-readable reason khi đạt một trong các budget:

```ts
type AdaptiveStopReason =
  | "stable-end"
  | "user-stop"
  | "max-duration"
  | "max-stored-bytes"
  | "max-tiles"
  | "storage-pressure"
  | "page-never-stabilized";
```

Budget đề xuất ban đầu:

- duration: 20 phút;
- max tile: 2.000;
- max stored bytes: nhỏ hơn giữa 1 GiB và quota ước tính còn lại;
- memory guard của exporter giữ nguyên;
- mỗi lần chỉ decode/capture một tile.

Trước S22 phải benchmark và khóa lại con số. Không thêm `unlimitedStorage` nếu chưa có ADR/permission review riêng.

## 3.5 Layout growth và fixed/sticky

- Page height tăng là expected behavior trong adaptive mode, không phải `E_LAYOUT_UNSTABLE` mặc định.
- Width, DPR, screenshot pixel scale hoặc viewport geometry thay đổi giữa capture vẫn là lỗi để tránh ghép sai.
- Smart fixed/sticky policy tiếp tục dùng namespaced ownership và compare-before-restore.
- Với header/footer lặp, logical crop phải loại phần overlap đã dùng cho alignment.
- S23 bổ sung fixture phát hiện duplicate horizontal strip ở seam.

# 4. Auto-PDF orchestration

## 4.1 Job policy

Thêm output workflow policy vào settings/job:

```ts
interface CaptureCompletionPolicy {
  autoExport: "pdf" | "none";
  openEditorAfterCapture: boolean;
}
```

Mặc định cho “Toàn trang → PDF”:

```ts
{
  autoExport: "pdf",
  openEditorAfterCapture: false
}
```

Mode `region`, `element`, `scroll-area` có thể dùng cùng policy; visible capture giữ output image hiện tại.

## 4.2 State flow

Luồng thành công:

```text
created
→ preparing
→ capturing
→ processing
→ ready
→ exporting
→ completed
```

`ready` là durable checkpoint: tile set đã hoàn chỉnh và trang đã được restore. Coordinator sau đó tự gọi `PdfExportService.start()` khi policy là auto-PDF. Nếu service worker restart ở `ready`, initialization phải phát hiện policy và có thể tiếp tục export idempotently. Nếu restart ở `exporting`, quy tắc recovery hiện tại có thể chuyển failed nhưng source tiles phải còn để retry.

Không gửi binary qua runtime message. Offscreen exporter tiếp tục đọc tile Blob trực tiếp từ IndexedDB.

## 4.3 Smart composition

“Ghép thông minh” trong 0.2.0 được định nghĩa bằng các invariant, không bằng xử lý hình ảnh mơ hồ:

- consume `logicalOutputRectCss`, `captureCropCss` và overlap metadata;
- xác minh source coverage liên tục theo CSS coordinate;
- reject gap, negative crop hoặc duplicate logical coverage;
- render từng PDF page, một canvas page tại một thời điểm;
- decode tối đa một tile tại một thời điểm;
- giữ residual pixel rounding để trang cuối kết thúc đúng source bottom;
- không tạo long-image canvas trước PDF;
- page size mặc định A4 portrait, margin 8 mm; user setting được tôn trọng;
- partial capture có metadata/watermark hoặc document property chỉ rõ là partial, không giả vờ complete.

S23 thêm seam-integrity fixture với pattern duy nhất theo trục Y để phát hiện thiếu/lặp strip.

## 4.4 Result actions

Sau `completed`, popup đọc `outputArtifactId` và hiển thị:

- `Tải PDF` — primary;
- `Chỉnh sửa trang` — secondary, mở editor hiện tại;
- `Chụp mới` — secondary;
- technical metadata nằm trong details/help.

# 5. Reset domain command

## 5.1 Contract

Thêm message versioned:

```ts
type CaptureResetScope = "visible-session" | "job" | "tab";

type CaptureResetDisposition = "discard-local-data";

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
    disposition: CaptureResetDisposition;
  };
}
```

Response trả số record đã xóa theo loại, không trả binary hoặc raw URL.

## 5.2 Semantics

### Terminal job

Theo thứ tự:

1. kiểm tra job identity/scope;
2. delete PDF edit manifest và thumbnail artifact;
3. delete output/source artifact thuộc job;
4. delete tiles;
5. delete job record;
6. delete job session summary;
7. release stale tab lock nếu còn;
8. trả success idempotently kể cả record đã không còn.

### Active job

1. đánh dấu cancellation/discard intent;
2. gọi coordinator cancel và engine/page cleanup;
3. chỉ sau cleanup attempt mới delete tile/artifact/job/session;
4. nếu cleanup partial, vẫn trả reset report có warning code để UI nói rõ page có thể cần reload;
5. không xóa job khác trên cùng tab nếu ID không khớp.

### Visible session

Xóa visible source/output artifact và `webcap.visible-session`; giữ settings và file đã download.

## 5.3 Repository service

Tạo `CaptureResetService` ở background thay vì để popup gọi từng repository. Service nhận các port:

```ts
jobs
jobSessions
tiles
artifacts
editorManifests
visibleSessions
captureCoordinator
pageCleanup
```

Mọi reset request phải có dedupe record theo `requestId` để retry an toàn.

# 6. Popup information architecture

## 6.1 Default surface

Cấu trúc mới:

```text
Header: WebCap + menu/help
Support notice: chỉ khi tab không hỗ trợ hoặc cần quyền
Primary goal selector:
  - Toàn trang → PDF
  - Vùng cụ thể
  - Màn hình hiện tại
Advanced target picker: chỉ mở khi chọn Vùng cụ thể
Primary CTA
Progress/result card
Advanced options (collapsed)
Help & diagnostics (collapsed or separate view)
```

## 6.2 Mapping mode

- `Toàn trang → PDF` → `full-page`, policy auto-PDF.
- `Vùng cụ thể` → submode `region | element | scroll-area`.
- `Màn hình hiện tại` → `visible`.

Không xóa capability hiện có; chỉ đổi information architecture.

## 6.3 Ẩn khỏi main flow

- worker status/version;
- current tab status khi supported;
- milestone/session badge;
- raw tile count và engine name;
- SHA-256/checksum;
- permission inventory;
- diagnostics button.

Các dữ liệu này chuyển vào `HelpDiagnosticsPanel`. Test selectors có thể giữ qua data attributes nhưng không hiển thị copy kỹ thuật.

## 6.4 Progress copy

UI dùng phase-level progress:

- “Đang chuẩn bị trang”;
- “Đang cuộn và chụp…”;
- “Đang tạo PDF…”;
- “PDF đã sẵn sàng”.

Percentage chỉ hiển thị khi denominator đáng tin cậy. Adaptive mode chưa biết tổng tile nên dùng captured length/phase, không hiển thị `x/? tile` trong main flow.

# 7. Storage và migration

- Bump settings schema nếu thêm `completionPolicy` hoặc UI preference.
- Job schema chỉ bump nếu persist adaptive frontier/completion policy trong `CaptureJob`.
- Migration phải giữ settings 0.1.0 và mặc định auto-PDF cho full-page mới; không tự động export job cũ không có policy.
- Reset chỉ xóa dữ liệu capture, không xóa locale hoặc settings.
- Expiry cleanup phải dùng cùng cleanup primitive với reset để tránh hai semantics xóa khác nhau.

# 8. Test strategy

## 8.1 Unit

- stable-end detector: static end, delayed growth, repeated growth, never stable;
- adaptive frontier: monotonic, overlap crop, final short viewport, gap rejection;
- reset service: terminal, active, duplicate, missing record, partial cleanup, isolation;
- auto-export state orchestration và restart at `ready`;
- settings/job migrations;
- UI view model mapping từ technical states sang plain-language phases.

## 8.2 E2E fixtures

1. Static page 30k.
2. Static page >100k.
3. Lazy-growth page thêm section sau mỗi bottom scroll rồi dừng hữu hạn.
4. Infinite fixture buộc guard và partial UX.
5. Fixed header/footer seam pattern.
6. Service-worker restart sau capture `ready` trước auto-export.
7. Reset completed job rồi capture lần hai trên cùng tab.
8. Reset active job và xác minh scroll/focus/style restoration.
9. Simplified popup keyboard flow và hidden diagnostics.
10. PDF integrity/page count/download và editor fallback.

## 8.3 Release gate

Mỗi session chạy format, lint, strict typecheck, unit, build và test liên quan. S25 chạy toàn bộ:

- privacy/dependency/release/security audits;
- unit suite;
- PDF benchmarks;
- Playwright full regression;
- DPR/zoom matrix;
- packaged install/update/uninstall;
- deterministic ZIP verification;
- acceptance traceability AC-01–AC-30.

# 9. Rollback boundaries

- S21 reset có thể rollback độc lập trước adaptive engine.
- S22 adaptive engine đứng sau capability/feature flag nội bộ cho đến khi E2E pass.
- S23 auto-PDF có thể tắt bằng completion policy mà không bỏ tile capture.
- S24 UI có thể rollback presentation nhưng không rollback contracts đã ổn định.
- Không upload 0.2.0 lên Chrome Web Store trước S25 release gate và approval riêng.
