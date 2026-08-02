---
product: WebCap
document: Session-sized Implementation Plan
version: 1.0
date: 2026-08-02
status: Active
repository: quoctran-2608/WebCap
owner: OpenAI coding agent
prd: ./PRD_WebCap_v1.0.md
spec: ./SPEC.md
current_session: S05
---

# WebCap — Session-sized Implementation Plan

> Tài liệu này chia `SPEC.md` thành các phiên triển khai đủ nhỏ để một coding agent có thể hoàn thành trọn vẹn trong một phiên làm việc, kiểm thử được, commit được và không cần nạp lại quá nhiều ngữ cảnh.

# 1. Mục đích

`PRD_WebCap_v1.0.md` định nghĩa sản phẩm cần xây. `SPEC.md` khóa kiến trúc và hợp đồng kỹ thuật. `PLAN.md` định nghĩa **thứ tự thực thi theo từng phiên**.

Khi tiếp tục dự án, tôi phải dùng tài liệu này làm sổ điều phối công việc:

1. Xác định session đầu tiên chưa hoàn thành.
2. Chỉ đọc các phần PRD/SPEC được chỉ ra cho session đó.
3. Hoàn thành một lát cắt có thể kiểm thử trong cùng phiên.
4. Không mở rộng phạm vi sang session kế tiếp chỉ vì còn thời gian.
5. Chạy đầy đủ validation của session.
6. Cập nhật trạng thái, ghi commit SHA và ghi chú kỹ thuật vào `PLAN.md`.
7. Commit và push code cùng cập nhật plan.

# 2. Nguyên tắc chia phiên

Mỗi session phải đáp ứng toàn bộ điều kiện:

- Có một mục tiêu kỹ thuật duy nhất, diễn đạt được trong một câu.
- Tạo ra output chạy được hoặc kiểm thử được, không chỉ tạo skeleton bỏ trống.
- Có phạm vi file tương đối hẹp.
- Có test hoặc validation cụ thể.
- Có tiêu chí dừng rõ ràng.
- Không cần quyết định lại kiến trúc đã khóa trong `SPEC.md`.
- Có thể rollback bằng một commit hoặc một nhóm commit nhỏ.
- Không để repo ở trạng thái build hỏng khi kết thúc.

Nếu công việc phát sinh vượt quá phạm vi, tôi phải ghi nó vào “Deferred / follow-up” thay vì kéo sang cùng session.

# 3. Kỷ luật token và ngữ cảnh

Các khoảng token dưới đây là **mục tiêu lập kế hoạch**, không phải cam kết tuyệt đối. Một session bình thường nên dùng khoảng **12k–25k token tổng ngữ cảnh và trao đổi**, session tích hợp khó có thể dùng đến khoảng **30k token**.

Để tiết kiệm token, tôi phải:

- Không đọc lại toàn bộ PRD trong mỗi session; chỉ đọc tóm tắt, acceptance criteria liên quan và section được chỉ định.
- Không đọc lại toàn bộ `SPEC.md`; dùng heading hoặc line range liên quan.
- Dùng `git diff --stat`, diff theo file và test output có chọn lọc; không dán log dài không cần thiết.
- Không tải toàn bộ dependency source vào ngữ cảnh nếu typings/docs chính thức đã đủ.
- Không tạo đồng thời nhiều phương án kiến trúc khi quyết định đã được khóa.
- Không refactor ngoài phạm vi session.
- Ưu tiên pure module và test nhỏ trước integration.
- Kết thúc phiên ngay khi exit criteria đạt; không tự ý bắt đầu session tiếp theo.

Nếu session vượt dự toán vì API/browser behavior phức tạp, tôi phải dừng ở một checkpoint build xanh, ghi rõ phần còn lại và tách một session bổ sung có mã `SxxA`.

# 4. Quy trình bắt đầu và kết thúc mỗi session

## 4.1 Bắt đầu

1. Đọc frontmatter của `PLAN.md` và tìm session `NEXT`.
2. Kiểm tra branch, commit gần nhất, working tree, PR và CI.
3. Đọc:
   - mục tiêu/acceptance criteria liên quan trong PRD;
   - section SPEC được session chỉ định;
   - ghi chú từ session trước.
4. Xác nhận dependency của session đã `DONE`.
5. Tạo branch `agent/sXX-short-name` nếu workflow hiện tại dùng PR; không trộn code session khác.
6. Ghi một checklist thực thi ngắn trước khi sửa code.

## 4.2 Kết thúc

1. Chạy validation bắt buộc.
2. Review diff để loại bỏ generated file, debug log và thay đổi ngoài phạm vi.
3. Cập nhật session thành `DONE`, thêm commit SHA, ngày và ghi chú.
4. Đặt session kế tiếp thành `NEXT` trong frontmatter.
5. Commit theo imperative mood.
6. Push và mở PR hoặc cập nhật PR theo workflow repo tại thời điểm đó.
7. Báo cáo ngắn: thay đổi, test, rủi ro còn lại và session kế tiếp.

# 5. Trạng thái

- `NEXT`: session phải triển khai tiếp theo.
- `READY`: dependency đã đủ nhưng chưa đến lượt.
- `BLOCKED`: có blocker cụ thể được ghi chú.
- `IN_PROGRESS`: đang thực hiện; không được có hai session cùng trạng thái này.
- `DONE`: đạt toàn bộ exit criteria và đã push.
- `DEFERRED`: không còn thuộc roadmap hiện tại.

# 6. Roadmap tổng quan

| Session | SPEC milestone | Capability hoàn thành | Phụ thuộc | Token mục tiêu | Trạng thái |
| --- | --- | --- | --- | ---: | --- |
| S00 | M0 | Bootstrap workspace và quality toolchain | Docs hiện có | 14k–22k | DONE |
| S01 | M0 | Manifest V3 multi-entry và popup ↔ worker handshake | S00 | 14k–22k | DONE |
| S02 | M0 | Shared contracts, settings, errors và CI | S01 | 16k–24k | DONE |
| S03 | M1 | Visible capture coordinator và Chrome adapter | S02 | 16k–24k | DONE |
| S04 | M1 | Offscreen processing, artifact storage và download | S03 | 18k–26k | DONE |
| S05 | M1 | Preview UI và visible-capture E2E | S04 | 16k–24k | NEXT |
| S06 | M2 | Persistent job state machine và repositories | S05 | 16k–24k | READY |
| S07 | M2 | Debugger client, page metrics và 2D tile planner | S06 | 20k–28k | READY |
| S08 | M2 | Page preparation, lazy settle và restoration | S07 | 20k–28k | READY |
| S09 | M2 | CDP tiled full-page capture, progress và cancel | S08 | 22k–30k | READY |
| S10 | M2 | Scroll fallback, fixed policy và long-page validation | S09 | 22k–30k | READY |
| S11 | M3 | CoordinateSpace và region selector | S10 | 18k–26k | READY |
| S12 | M3 | Element selector và target capture | S11 | 18k–26k | READY |
| S13 | M4 | PDF page slicing và page-at-a-time exporter | S12 | 20k–28k | READY |
| S14 | M4 | Editor, PDF options và export retry | S13 | 20k–28k | READY |
| S15 | M4 | PDF benchmarks, integrity và memory guards | S14 | 18k–26k | READY |
| S16 | M5 | Scrollable-container detection và capture | S15 | 22k–30k | READY |
| S17 | M5 | PDF source detection và original passthrough | S16 | 18k–26k | READY |
| S18 | M6 | Hardening lazy/infinite/iframe/canvas/WebGL | S17 | 22k–30k | READY |
| S19 | M6 | Diagnostics, i18n, privacy và permissions | S18 | 18k–26k | READY |
| S20 | M6 | Release candidate, packaging và store readiness | S19 | 18k–26k | READY |

# 7. Session chi tiết

## S00 — Bootstrap workspace và quality toolchain

**Mục tiêu:** biến repo tài liệu hiện tại thành workspace TypeScript có thể cài dependency, lint, typecheck, unit test và build một entry JavaScript tối thiểu.

**Đọc trước:** SPEC §3–5, §27–29, §31–33.

**Trong phạm vi:**

- Khởi tạo `package.json` với pnpm và Node engine.
- Pin dependency nền tảng: TypeScript, Vite, React, Vitest, ESLint, Prettier.
- Thêm `tsconfig.json`, alias, strict flags theo SPEC.
- Thêm cấu hình ESLint/Prettier/Vitest/Vite tối thiểu.
- Tạo `src/shared/` và một pure utility nhỏ có unit test để chứng minh toolchain.
- Thêm `.gitignore`, `CHANGELOG.md`, script package placeholder hợp lệ.
- Cập nhật README với lệnh cài đặt/chạy kiểm tra cơ bản.

**Ngoài phạm vi:** manifest, Chrome API, popup UI, service worker, CI.

**Validation:**

```bash
pnpm install --frozen-lockfile=false
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

**Exit criteria:** lockfile được commit; tất cả command pass; không có `any`; repo không commit `dist/` hoặc `node_modules/`.

**Commit gợi ý:** `Bootstrap TypeScript extension workspace`.

---

## S01 — Manifest V3 multi-entry và popup ↔ worker handshake

**Mục tiêu:** build được extension unpacked với popup React và service worker module giao tiếp qua một message ping typed tối thiểu.

**Đọc trước:** SPEC §5–6, phần message protocol ở §8, UI M0 ở §26.

**Trong phạm vi:**

- Tạo `public/manifest.json` đúng quyền trong SPEC.
- Cấu hình Vite multi-entry cho popup và service worker.
- Tạo popup shell React tối giản, không nút giả cho capability chưa có.
- Tạo service worker và message router tối thiểu.
- Thêm `PING`/`PONG` contract typed.
- Hiển thị trạng thái worker trong popup.
- Tạo icon placeholder nội bộ hợp lệ, không dùng remote asset.
- Thêm script package ZIP nếu đủ nhỏ; nếu chưa, chỉ build unpacked.

**Ngoài phạm vi:** capture, settings thực, offscreen, downloads.

**Validation:** lint/typecheck/unit/build; kiểm tra output có manifest, popup và worker; manual load unpacked và ping thành công.

**Exit criteria:** extension load không có manifest error; popup hiển thị worker connected; quyền không vượt SPEC.

**Commit gợi ý:** `Add Manifest V3 popup and worker handshake`.

---

## S02 — Shared contracts, settings, errors và CI

**Mục tiêu:** hoàn tất nền tảng M0 để mọi subsystem sau dùng cùng contract, validation, error model và quality gate.

**Đọc trước:** SPEC §7–12, §24–25, §28–32.

**Trong phạm vi:**

- Định nghĩa domain types cốt lõi và protocol version.
- Zod schemas tại biên runtime message/storage.
- `Result<T, E>`, error normalization và safe logger.
- Settings schema, defaults, migration v1 và repository dùng `chrome.storage.local` adapter.
- Capability response cho popup; feature flags tắt capability chưa có.
- Unit tests cho validation, migration, error redaction và message mismatch.
- GitHub Actions CI: install, format check, lint, typecheck, unit, build.
- `docs/privacy.md` bản nền tảng local-first.

**Ngoài phạm vi:** job persistence, tile storage và capture.

**Validation:** toàn bộ scripts local; review workflow YAML; thử test adapter không cần Chrome thật.

**Exit criteria M0:** install/lint/typecheck/unit/build pass; CI file hợp lệ; popup-worker handshake dùng contract thật; README đủ load unpacked.

**Commit gợi ý:** `Define contracts settings and CI`.

---

## S03 — Visible capture coordinator và Chrome adapter

**Mục tiêu:** từ popup, tạo một visible-capture request và nhận ảnh viewport từ `chrome.tabs.captureVisibleTab()` qua coordinator có thể test.

**Đọc trước:** PRD visible capture; SPEC §7–14, phần M1 §26/§30.

**Trong phạm vi:**

- Typed adapters cho tabs/runtime API.
- Active-tab capability/unsupported URL check.
- Capture request và in-memory coordinator cho một job.
- Rate-limit abstraction cho `captureVisibleTab`.
- Trả metadata ảnh và Blob/data boundary hợp lý; chưa làm download hoàn chỉnh.
- Cancel trước/sau API call ở mức hợp lý.
- Integration tests với mocked Chrome API.

**Ngoài phạm vi:** IndexedDB tile, offscreen encode, preview hoàn chỉnh.

**Validation:** unit/integration; manual capture trên fixture đơn giản; đảm bảo popup/overlay không lọt vào ảnh.

**Exit criteria:** một click có thể tạo ảnh viewport thành công; lỗi unsupported/permission được normalize; duplicate request không tạo hai job.

**Commit gợi ý:** `Implement visible capture coordinator`.

**Hoàn thành:** 2026-08-02 · PR #7 · validation head `710ce8d`.

**Ghi chú kỹ thuật:** visible/PNG đã hoạt động qua typed Chrome adapter và coordinator in-memory; runtime chỉ truyền metadata, request trùng được dedupe, capture cạnh tranh bị chặn và cancel được normalize. CI sạch pass format, lint, typecheck, 52 unit tests và build. Pixel persistence, offscreen processing và download được chuyển đúng sang S04.

---

## S04 — Offscreen processing, artifact storage và download

**Mục tiêu:** chuyển ảnh capture thành artifact PNG/JPEG/WebP trong offscreen document, lưu local và tải xuống an toàn.

**Đọc trước:** SPEC §11–12, §21, §23–25.

**Trong phạm vi:**

- Offscreen document manager chống race bằng `runtime.getContexts()`.
- Offscreen message contract.
- IndexedDB schema đầu tiên cho artifact/blob metadata.
- Decode/encode ảnh và quality setting.
- Filename sanitizer.
- Download service và Blob URL lifecycle.
- Retry processing/download không capture lại.
- Unit/integration tests cho filename, offscreen handshake, storage failure, download failure.

**Ngoài phạm vi:** full-page tile repository và PDF.

**Validation:** tải được PNG/JPEG/WebP mở hợp lệ; object URL được revoke; không lưu base64 trong storage.

**Exit criteria:** artifact survives popup close; download tên file đúng; lỗi quota/offscreen/download có user-safe code.

**Commit gợi ý:** `Add offscreen image export and download`.

**Hoàn thành:** 2026-08-02 · PR #8 · validation head `a4eeaa5`.

**Ghi chú kỹ thuật:** source/output image được lưu bằng Blob trong IndexedDB; offscreen manager chống race bằng runtime.getContexts(), encode PNG/JPEG/WebP và quản lý Blob URL; download luôn revoke URL trong finally; retry export/download không gọi captureVisibleTab lại. CI sạch pass format, lint, typecheck, 69 unit tests và build có offscreen.html/offscreen.js. Manual Chrome E2E được giữ đúng phạm vi S05.

---

## S05 — Preview UI và visible-capture E2E

**Mục tiêu:** hoàn tất lát cắt M1 từ thao tác popup đến preview và download, có E2E smoke ổn định.

**Đọc trước:** PRD AC cho visible/image export; SPEC UI M1 và §27.

**Trong phạm vi:**

- Preview tối thiểu: thumbnail, dimensions, format, estimate, download/retry/cancel.
- Job status synchronization khi popup đóng/mở lại.
- Fixture server và Playwright extension harness.
- E2E visible capture trên trang thường.
- Test DPR/zoom tối thiểu khả thi; ghi giới hạn môi trường CI.
- Accessibility cơ bản cho popup controls.

**Ngoài phạm vi:** editor nhiều trang, full-page, PDF.

**Validation:** lint/typecheck/unit/build/E2E smoke; manual Chrome unpacked.

**Exit criteria M1:** visible capture và image download hoàn chỉnh; E2E smoke pass; không P0/P1 trong flow này.

**Commit gợi ý:** `Complete visible capture preview flow`.

---

## S06 — Persistent job state machine và repositories

**Mục tiêu:** tạo coordinator bền vững đủ cho full-page jobs, có state transition, recovery summary và tile metadata repository.

**Đọc trước:** SPEC domain/state/message/storage sections §7–12, tests §27.

**Trong phạm vi:**

- State transition table và guards.
- Job repository dùng storage session cho summary.
- IndexedDB tile/artifact schema có versioning.
- Single coordinator lock per tab/job.
- Idempotent command/message handling.
- Recovery behavior khi service worker restart.
- Cleanup policy cho abandoned/completed jobs.
- Unit/integration tests state, duplicate message, transaction failure, restart.

**Ngoài phạm vi:** CDP command và capture tile thật.

**Validation:** pure state coverage cao; simulated restart; no binary in chrome.storage.

**Exit criteria:** invalid transition bị chặn; job summary khôi phục được; cleanup không xóa job đang active.

**Commit gợi ý:** `Add persistent capture job state machine`.

---

## S07 — Debugger client, page metrics và 2D tile planner

**Mục tiêu:** attach/detach debugger an toàn, đo layout và sinh tile plan 2D deterministic mà chưa chạy capture loop hoàn chỉnh.

**Đọc trước:** SPEC debugger/metrics/tile sections §13–16, TV-01, error model.

**Trong phạm vi:**

- Typed debugger adapter và `sendCommand` wrapper.
- Attach ownership, timeout và detach in `finally`.
- Page domain enable/getLayoutMetrics adapter.
- Normalize CSS content size, viewport, DPR.
- Pure 2D tile planner với max area, edge tile và overlap metadata.
- Dynamic split guard cho kích thước quá lớn.
- Unit tests cho 10k/30k/100k height, wide page, fractional size.
- Integration tests attach/detach trên success/error/detach event.

**Ngoài phạm vi:** page mutation, screenshot loop, progress UI.

**Validation:** planner deterministic; mọi debugger path detach; error code đúng.

**Exit criteria:** có thể attach, đọc metrics, lập plan và detach mà không chụp; planner không tạo gap/negative/zero tile.

**Commit gợi ý:** `Implement debugger metrics and tile planner`.

---

## S08 — Page preparation, lazy settle và restoration

**Mục tiêu:** chuẩn bị trang trước capture và phục hồi chính xác sau success/error/cancel.

**Đọc trước:** SPEC page preparation/restoration/lazy/fixed sections §15–17; fixtures §27.

**Trong phạm vi:**

- Content script injection/handshake.
- Snapshot scroll, inline styles và modified nodes.
- Disable smooth scroll, transitions/animations, caret và WebCap overlay.
- Lazy-load pre-scroll policy và layout settle abstraction.
- Restore idempotent trong `finally`.
- Cleanup comparison và `E_CLEANUP_PARTIAL`.
- Fixtures lazy-images, animated-page, layout-shift, fixed/sticky cơ bản.
- Unit/integration/E2E preparation-restore tests.

**Ngoài phạm vi:** smart fixed hoàn chỉnh và capture loop.

**Validation:** DOM/scroll sau test khớp snapshot; cancel giữa prepare vẫn restore.

**Exit criteria:** không để style/class/scroll thay đổi sau mọi exit path; settle có timeout và không dùng sleep tùy tiện.

**Commit gợi ý:** `Add page preparation and restoration`.

---

## S09 — CDP tiled full-page capture, progress và cancel

**Mục tiêu:** hoàn thành full-page engine chính: prepare → measure → plan → capture tiles → store → ready.

**Đọc trước:** SPEC §13–17, job/state sections, UI M2.

**Trong phạm vi:**

- `CdpCaptureEngine` theo interface chung.
- Capture `Page.captureScreenshot` từng tile với clip ngoài viewport.
- Persist từng tile ngay sau capture.
- Progress event có completed/total/stage.
- Cancel checkpoints giữa tiles.
- Retry tile có giới hạn; không retry lỗi không retryable.
- Detach và restore trong mọi path.
- Popup progress/cancel/fallback prompt shell.
- Long-page fixture ban đầu.

**Ngoài phạm vi:** scroll fallback hoàn chỉnh, smart fixed, final full-page image merge.

**Validation:** E2E full-page nhiều tile; cancel giữa chừng; forced CDP error; debugger detach assertion.

**Exit criteria:** tile set đầy đủ và theo thứ tự; không gap trong logical coordinates; cancel kết thúc `cancelled`, cleanup sạch.

**Commit gợi ý:** `Implement CDP tiled full-page capture`.

---

## S10 — Scroll fallback, fixed policy và long-page validation

**Mục tiêu:** hoàn tất M2 bằng fallback usable và bằng chứng full-page ổn định trên trang dài.

**Đọc trước:** SPEC scroll fallback/fixed/overlap sections §14–17, test/performance §27.

**Trong phạm vi:**

- Scroll capture engine với rate limiter ≥ giới hạn API.
- Viewport tile overlap/crop metadata.
- Basic overlap resolver.
- Fixed modes preserve/remove/smart prototype.
- Automatic fallback policy từ CDP errors được phép.
- Fixtures sticky-header, fixed-header-footer, wide-table.
- E2E và benchmark 10k/30k; 100k smoke nếu môi trường cho phép.
- Progress và diagnostics cho fallback.

**Ngoài phạm vi:** nested scroll container riêng.

**Validation:** visual diff các fixture chính; restore scroll; no duplicate smart header ngoài policy.

**Exit criteria M2:** full-page CDP và fallback chạy; progress/cancel/restore đạt AC liên quan; benchmark được ghi vào docs.

**Commit gợi ý:** `Add full-page scroll fallback`.

---

## S11 — CoordinateSpace và region selector

**Mục tiêu:** người dùng kéo/chỉnh một vùng vượt viewport và hệ thống tạo target rect chính xác theo document coordinates.

**Đọc trước:** SPEC §18, coordinate contracts và UI M3.

**Trong phạm vi:**

- `CoordinateSpace` pure module cho client/visual viewport/document/device pixels.
- Isolated overlay root với CSS namespace.
- Drag, resize handles, keyboard cancel/confirm.
- Auto-scroll khi pointer gần edge.
- Dimensions display và bounds normalization.
- Remove overlay + wait frames trước capture.
- Capture region qua engine hiện có.
- Unit coordinate matrix; E2E zoom/DPR quan trọng.

**Ngoài phạm vi:** arbitrary polygon, annotation, element inspector.

**Validation:** selected rect và output sai số tối đa theo SPEC/PRD; keyboard path hoạt động.

**Exit criteria:** region dài hơn viewport chụp đủ; overlay không xuất hiện trong output; cancel không thay đổi trang.

**Commit gợi ý:** `Implement region capture selector`.

---

## S12 — Element selector và target capture

**Mục tiêu:** hover/chọn một DOM element, điều hướng parent/child và chụp bounds chính xác với stale-target handling.

**Đọc trước:** SPEC §19 và phần scroll candidate §20.

**Trong phạm vi:**

- Candidate selection qua `elementsFromPoint()`/`composedPath()`.
- Highlight, label sanitized và dimensions.
- Parent/child keyboard navigation.
- Ignore WebCap root và invalid root nodes.
- Stable target descriptor; revalidate trước capture.
- `E_TARGET_STALE` và reselection flow.
- Lựa chọn visible bounds; full scroll content chỉ route sang capability S16 khi có.
- Shadow DOM open fixture và E2E.

**Ngoài phạm vi:** closed shadow deep inspection, full container capture.

**Validation:** E2E normal/shadow/stale; accessibility keyboard.

**Exit criteria M3:** region và element acceptance criteria đạt; target biến mất không làm capture sai element khác.

**Commit gợi ý:** `Implement element capture selector`.

---

## S13 — PDF page slicing và page-at-a-time exporter

**Mục tiêu:** tạo PDF nhiều trang từ logical tile set mà không tạo canvas toàn trang.

**Đọc trước:** SPEC §21–23, TV-02, PRD PDF acceptance criteria.

**Trong phạm vi:**

- Unit conversion mm/pt và page-size presets.
- Pure page slicing với running fractional offset.
- Tile-to-page intersection planner.
- Offscreen page canvas chỉ bằng một PDF page.
- `pdf-lib` adapter và JPEG page embedding.
- Artifact persistence và export progress.
- Unit tests gap/overlap/rounding; integration small PDF.

**Ngoài phạm vi:** editor reorder/remove và full benchmark suite.

**Validation:** generated PDF mở được; page count/source coverage đúng; decoded tile count giới hạn.

**Exit criteria:** không có canvas logical full page; không tích lũy seam do rounding; memory cleanup sau page.

**Commit gợi ý:** `Implement paged PDF exporter`.

---

## S14 — Editor, PDF options và export retry

**Mục tiêu:** cung cấp editor tối thiểu để preview page, chọn PDF settings, remove/reorder và export lại không capture lại.

**Đọc trước:** SPEC UI M4, §22–23, job artifact behavior.

**Trong phạm vi:**

- Editor entry React và route bằng job ID.
- Page thumbnails lazy-loaded.
- Remove/reorder logical pages.
- A4, Letter, fit-width; portrait/landscape; margin/quality.
- Estimate đơn giản có nhãn approximate.
- Export state/progress/cancel/retry.
- Persist edit manifest tách khỏi tile gốc.
- Component/integration tests.

**Ngoài phạm vi:** annotation, image filters, OCR.

**Validation:** reload editor không mất manifest; retry export không capture; keyboard reorder cơ bản.

**Exit criteria:** người dùng tạo và tải PDF theo settings; tile source không bị mutation/destructive delete.

**Commit gợi ý:** `Add PDF editor and export options`.

---

## S15 — PDF benchmarks, integrity và memory guards

**Mục tiêu:** chứng minh pipeline PDF chịu được trang dài mục tiêu và chặn an toàn output vượt guardrail.

**Đọc trước:** SPEC §21–22, §27.5, TV-01/TV-02, NFR liên quan trong PRD.

**Trong phạm vi:**

- Benchmark fixtures 10k, 30k, 100k CSS px.
- Record duration, artifact size, peak heap best-effort và decoded concurrency.
- PDF integrity checker: page count, dimensions, non-empty streams.
- Memory guard và user-facing alternative: lower quality/split/multi-page.
- Error normalization `E_MEMORY_GUARD`, `E_EXPORT_FAILED`.
- ADR chỉ khi benchmark buộc đổi library/pipeline.
- `docs/benchmarks.md` với môi trường và kết quả.

**Ngoài phạm vi:** tối ưu vi mô không có benchmark.

**Validation:** benchmark repeatable; no unexplained crash; failure path giữ source để retry.

**Exit criteria M4:** PDF acceptance criteria đạt; quyết định pdf-lib được xác nhận hoặc ADR thay thế được commit.

**Commit gợi ý:** `Validate PDF export performance`.

---

## S16 — Scrollable-container detection và capture

**Mục tiêu:** chọn một container có overflow và chụp toàn bộ scrollWidth/scrollHeight bằng viewport crop tiles.

**Đọc trước:** SPEC §19–21, TV-06, PRD scroll-area acceptance criteria.

**Trong phạm vi:**

- Candidate detection theo computed overflow và dimensions.
- Target snapshot/revalidation.
- 2D container tile plan theo client box.
- Internal scroll, visible capture, crop rect và overlap resolution.
- Sticky child policy cục bộ.
- Restore scrollTop/scrollLeft/styles.
- Fixtures nested-scroll, wide table, modal/chat-like panel.
- E2E success/cancel/stale/restore.

**Ngoài phạm vi:** browser-internal PDF viewer inaccessible DOM.

**Validation:** output đủ logical content container; document scroll không bị thay đổi ngoài dự kiến.

**Exit criteria:** AC scroll-area đạt; container capture dùng fallback engine rõ ràng và cleanup sạch.

**Commit gợi ý:** `Implement scrollable area capture`.

---

## S17 — PDF source detection và original passthrough

**Mục tiêu:** nhận biết nguồn PDF có thể truy cập, cho tải nguyên bản khi an toàn và route trường hợp cần raster capture.

**Đọc trước:** PRD PDF source scope; SPEC M5 và privacy/permission sections.

**Trong phạm vi:**

- Detect URL/content-type PDF qua các tín hiệu được phép.
- Capability model: original passthrough, viewer capture, unsupported/auth-required.
- Optional host/file permission request đúng lúc.
- Download original bytes khi accessible và người dùng chọn.
- Không rasterize lại khi passthrough đáp ứng yêu cầu.
- Fixtures PDF public/local và auth-like failure.
- Privacy/error copy rõ ràng.

**Ngoài phạm vi:** PDF.js viewer riêng trừ khi prototype chứng minh bắt buộc; khi đó tạo ADR/session bổ sung.

**Validation:** original hash/size hợp lý; permission denied không phá flow ảnh; no credential logging.

**Exit criteria M5:** PDF source smoke đạt; unsupported case có hướng dẫn/fallback trung thực.

**Commit gợi ý:** `Add PDF source passthrough`.

---

## S18 — Hardening lazy/infinite/iframe/canvas/WebGL

**Mục tiêu:** làm capture engine ổn định trên các nhóm trang khó bắt buộc của MVP.

**Đọc trước:** PRD edge cases; SPEC §15–17, §27 fixtures và open validations.

**Trong phạm vi:**

- Infinite-scroll stop conditions: height/tile/time/user stop.
- Lazy image settle và maximum growth policy.
- Same-origin/cross-origin iframe pixel behavior.
- Canvas/WebGL fixture capture validation.
- Scroll-snap/layout-shift mitigations.
- Zoom/DPR matrix trọng yếu.
- Visual regression goldens được review có chọn lọc.
- Ghi known limitations trung thực.

**Ngoài phạm vi:** DRM/protected video bypass, browser internal restricted pages.

**Validation:** full fixture matrix liên quan; no silent truncation; output cảnh báo khi user stop/limit.

**Exit criteria:** các case bắt buộc có pass hoặc documented limitation được PRD chấp nhận; không P0/P1.

**Commit gợi ý:** `Harden capture edge cases`.

---

## S19 — Diagnostics, i18n, privacy và permissions

**Mục tiêu:** hoàn thiện trải nghiệm lỗi, ngôn ngữ và minh bạch quyền trước release candidate.

**Đọc trước:** SPEC §6, §24–26, PRD privacy/security/NFR.

**Trong phạm vi:**

- i18n Việt/Anh cho UI và error keys.
- Safe diagnostics JSON + copy action.
- Production logger default `warn` và redaction audit.
- Permission rationale/onboarding.
- Privacy document hoàn chỉnh; xác nhận local-first/no analytics mặc định.
- Accessibility pass popup/editor/selector.
- Unsupported URL/restricted page copy.
- Dependency/license audit cơ bản.

**Ngoài phạm vi:** telemetry backend, account, cloud sync.

**Validation:** scan log/diagnostics không có URL/text/image/token; locale fallback; keyboard/screen-reader smoke.

**Exit criteria:** privacy/permission behavior khớp store claim; toàn bộ user-facing lỗi có message hữu ích.

**Commit gợi ý:** `Add diagnostics localization and privacy UX`.

---

## S20 — Release candidate, packaging và store readiness

**Mục tiêu:** tạo một release candidate cài được, test được và đủ hồ sơ kỹ thuật để phát hành nội bộ/Chrome Web Store.

**Đọc trước:** toàn bộ exit criteria PRD, SPEC M6/DoD, tất cả session notes.

**Trong phạm vi:**

- Full lint/typecheck/unit/integration/E2E/visual/performance suite đã chọn.
- Production build và deterministic ZIP.
- Manifest permission/version audit.
- Test install/update/uninstall trên clean profile.
- Release checklist, known limitations, privacy/store copy.
- CHANGELOG và version `0.1.0` hoặc version được quyết định.
- Tag/release workflow chuẩn bị; không publish store nếu chưa có chỉ thị cụ thể.
- Triage toàn bộ P0/P1 và critical dependency alerts.

**Ngoài phạm vi:** tính năng mới.

**Validation:** packaged extension chạy trên Chrome minimum và current stable được test; artifact checksum ghi nhận.

**Exit criteria M6:** toàn bộ MUST acceptance criteria pass; không P0/P1; ZIP reproducible; docs/release notes hoàn chỉnh.

**Commit gợi ý:** `Prepare WebCap release candidate`.

# 8. Quality gates theo giai đoạn

## Sau S02 — Foundation gate

- Build extension unpacked thành công.
- CI xanh.
- Contract/version/error/settings có test.
- Không bắt đầu capture nếu gate này chưa đạt.

## Sau S05 — Visible slice gate

- Visible capture từ UI đến download hoàn chỉnh.
- E2E smoke chạy ổn định.
- Offscreen/storage/download lifecycle đã chứng minh.

## Sau S10 — Full-page gate

- CDP và fallback có test.
- Cancel/restore/detach không rò rỉ.
- Long-page benchmark cơ bản được ghi nhận.

## Sau S12 — Selection gate

- Region và element modes chính xác trên coordinate matrix.
- Overlay accessible và không lọt output.

## Sau S15 — PDF gate

- PDF nhiều trang không gap/missing content.
- Memory guard được benchmark.
- Retry export không recapture.

## Sau S17 — Source/container gate

- Scroll container và PDF passthrough đạt smoke/E2E.
- Permission flows rõ ràng.

## Sau S20 — Release gate

- Tất cả MUST acceptance criteria pass.
- Không P0/P1.
- Package và tài liệu phát hành hoàn chỉnh.

# 9. Quy tắc phát sinh session bổ sung

Chỉ thêm `SxxA` khi một trong các điều kiện xảy ra:

- Một Chrome API cần prototype độc lập trước implementation.
- Session vượt quá khoảng 30k token hoặc không thể hoàn thành với build xanh.
- Một dependency/library phải thay đổi theo benchmark.
- Một bug nền tảng cần sửa trước khi tiếp tục nhưng không thuộc scope session hiện tại.

Session bổ sung phải ghi:

- nguyên nhân tách;
- deliverable duy nhất;
- dependency;
- validation;
- ảnh hưởng đến roadmap;
- ADR nếu thay đổi quyết định khóa.

Không dùng session bổ sung để chứa “misc fixes” không có phạm vi.

# 10. Deferred / không nằm trong MVP

Không đưa các mục sau vào S00–S20 nếu PRD/SPEC không được cập nhật:

- Cloud upload/sync.
- Tài khoản người dùng.
- Team collaboration.
- OCR.
- Annotation/editor nâng cao.
- Video recording.
- DRM/protected-content bypass.
- Firefox/Safari support.
- Backend analytics.
- Remote script/CDN.

# 11. Nhật ký thực thi

Mỗi session khi hoàn thành phải thêm một dòng. Không ghi log chi tiết dài; liên kết commit/PR là nguồn sự thật.

| Session | Status | Date | Commit/PR | Tests | Notes |
| --- | --- | --- | --- | --- | --- |
| S00 | DONE | 2026-08-02 | 44757499ab7f | format, lint, typecheck, unit, build | Workspace và lockfile đã được xác thực trên GitHub Actions. |
| S01 | DONE | 2026-08-02 | 461a6b8560d3 | format, lint, typecheck, unit, build, Chrome smoke | Manifest V3 load được; popup kết nối service worker bằng PING/PONG typed. |
| S02 | DONE | 2026-08-02 | 6e6a76659173 | format, lint, typecheck, unit, build, Chrome smoke | Shared Zod contracts, settings migration/repository, error model, safe logger và CI đã được xác thực. |
| S03 | DONE | 2026-08-02 | PR #7 / 710ce8d | format, lint, typecheck, 52 unit, build | Visible capture coordinator, typed Chrome adapter, metadata-only protocol, dedupe, rate limit và cancel đã được xác thực. |
| S04 | DONE | 2026-08-02 | PR #8 / a4eeaa5 | format, lint, typecheck, 69 unit, build | Blob artifact persistence, offscreen PNG/JPEG/WebP processing, filename sanitizer, download lifecycle và retry không recapture đã được xác thực. |
| S05 | NEXT | — | — | — | Sẵn sàng hoàn tất preview UI và visible-capture E2E. |
| S06 | READY | — | — | — | — |
| S07 | READY | — | — | — | — |
| S08 | READY | — | — | — | — |
| S09 | READY | — | — | — | — |
| S10 | READY | — | — | — | — |
| S11 | READY | — | — | — | — |
| S12 | READY | — | — | — | — |
| S13 | READY | — | — | — | — |
| S14 | READY | — | — | — | — |
| S15 | READY | — | — | — | — |
| S16 | READY | — | — | — | — |
| S17 | READY | — | — | — | — |
| S18 | READY | — | — | — | — |
| S19 | READY | — | — | — | — |
| S20 | READY | — | — | — | — |

# 12. Lệnh bắt đầu lần triển khai kế tiếp

Session kế tiếp là **S05 — Preview UI và visible-capture E2E**.

Khi được yêu cầu tiếp tục code, tôi phải:

1. Đọc `PLAN.md` phần S05.
2. Đọc PRD acceptance criteria cho visible/image export, SPEC UI M1 và §27.
3. Kiểm tra repo/branch và kết quả CI S04.
4. Chỉ triển khai S05.
5. Kết thúc với preview UI, popup state synchronization và visible-capture E2E smoke đầy đủ.
