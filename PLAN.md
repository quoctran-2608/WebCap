---
product: WebCap
document: Active Implementation Plan
version: 1.1
date: 2026-08-04
status: Planned
repository: quoctran-2608/WebCap
owner: OpenAI coding agent
prd: ./PRD_WebCap_v1.1.md
spec: ./docs/spec-0.2.0.md
release_target: 0.2.0
current_session: S21
---

# WebCap — Implementation plan 0.2.0

Roadmap MVP `S00–S20` đã hoàn tất và tạo release candidate 0.1.0. Yêu cầu sản phẩm ngày 2026-08-04 mở roadmap mới `S21–S25` nhằm nâng cấp luồng chụp toàn trang thành **tự cuộn đến cuối nội dung ổn định → tự tạo PDF**, bổ sung reset/chụp mới và đơn giản hóa popup.

PR kế hoạch chỉ cập nhật tài liệu. Không thay đổi source, manifest, package version hoặc artifact 0.1.0.

# 1. Nguồn sự thật

- `PRD_WebCap_v1.0.md`: baseline và acceptance criteria AC-01–AC-18 của 0.1.0.
- `PRD_WebCap_v1.1.md`: delta sản phẩm 0.2.0 và AC-19–AC-30.
- `SPEC.md`: baseline architecture/contracts 0.1.0.
- `docs/spec-0.2.0.md`: engineering addendum cho adaptive scroll, auto-PDF, reset và popup IA.
- `PLAN.md`: session hiện tại, dependencies, exit criteria và validation.
- `CHANGELOG.md`: chỉ cập nhật khi behavior/code thực sự thay đổi.
- `docs/known-limitations.md`: cập nhật trong S25 theo behavior 0.2.0 đã xác thực.

# 2. Nguyên tắc triển khai

- Mỗi PR chỉ hoàn thành một session có thể kiểm thử; không trộn reset, engine, exporter và UI trong cùng PR.
- Thay đổi contract/storage schema phải đi trước UI sử dụng contract đó.
- Test được thêm hoặc cập nhật trong cùng PR với behavior.
- Không tự tuyên bố “unlimited”. Auto-scroll không còn dừng bởi ngưỡng chiều cao CSS 100.000 px cố định, nhưng vẫn có budget thời gian, tile, storage và memory.
- Không thêm backend, telemetry, analytics, account, cloud sync, remote code, required permission hoặc default host permission.
- Không tạo full-page canvas; PDF tiếp tục page-at-a-time và decoded-tile concurrency bị giới hạn.
- Mọi success/error/cancel/reset phải cố gắng phục hồi scroll, focus, selection và WebCap-owned mutations.
- Không thay thế artifact 0.1.0 đã được xác thực. Package 0.2.0 chỉ được tạo sau S25.

# 3. Baseline đã hoàn tất

| Session | Capability | Status |
| --- | --- | --- |
| S00–S05 | Workspace, MV3, contracts, visible capture, local export và preview | DONE |
| S06–S10 | Persistent jobs, CDP tiled capture, page preparation và scroll fallback | DONE |
| S11–S12 | Region và element capture | DONE |
| S13–S15 | Page-at-a-time PDF, editor, benchmarks và memory guards | DONE |
| S16–S18 | Scroll-area, original PDF passthrough và difficult-page hardening | DONE |
| S19 | i18n, diagnostics, privacy, permissions và accessibility | DONE |
| S20 | 0.1.0 release candidate, deterministic package và store readiness | DONE |

Release baseline cần giữ xanh trong mọi session 0.2.0:

- 279 unit tests / 79 files.
- 4 PDF benchmark scenarios.
- 38 Playwright E2E cases.
- Manifest V3 build verification.
- Privacy, dependency/license, release metadata và critical-security audits.
- DPR `1/1.5/2` × zoom `80/100/125/150%` release matrix.

# 4. Roadmap 0.2.0

| Session | Capability | Status | Depends on |
| --- | --- | --- | --- |
| S21 | Reset lifecycle và “Chụp mới” domain foundation | PLANNED | S20 |
| S22 | Adaptive auto-scroll đến stable end | BLOCKED | S21 contracts/cleanup primitives |
| S23 | Auto-PDF orchestration và seam-integrity composition | BLOCKED | S22 |
| S24 | Simplified popup và progressive disclosure | BLOCKED | S21–S23 stable contracts |
| S25 | Hardening, migration, docs và 0.2.0 release candidate | BLOCKED | S21–S24 |

# 5. S21 — Reset lifecycle và “Chụp mới”

## 5.1 Mục tiêu

Cho phép người dùng bỏ kết quả hiện tại và bắt đầu capture mới ở mọi trạng thái, đồng thời tạo một cleanup primitive duy nhất để UI, expiry cleanup và future adaptive jobs dùng chung.

## 5.2 Phạm vi code

- Thêm contract `CAPTURE_RESET` và response report versioned.
- Thêm `CaptureResetService` ở background.
- Mở rộng repository ports để xóa theo job/session một cách explicit:
  - job;
  - tile;
  - source/output artifact;
  - PDF edit manifest;
  - thumbnail;
  - job summary/tab lock;
  - visible session.
- Reset terminal job: dọn local data và cho phép tạo job mới cùng tab ngay.
- Reset active job: cancel → cleanup page → discard local data.
- Dedupe reset theo `requestId`; missing record trả success idempotent.
- Reuse cleanup primitive trong `cleanupExpired()` để tránh semantics xóa khác nhau.
- Thêm popup client/handler tối thiểu và nút “Chụp mới” trong UI hiện tại; redesign đầy đủ để S24.
- Giữ settings, locale và downloaded files.

## 5.3 Ngoài phạm vi

- Không đổi auto-scroll engine.
- Không tự động export PDF.
- Không redesign popup toàn diện.
- Không bump package version.

## 5.4 Validation

- Unit contract/parser/router.
- Reset service terminal/active/missing/duplicate/isolation/partial-cleanup.
- Repository deletion counts và transaction failure.
- E2E:
  - completed tiled job → Chụp mới → capture lần hai cùng tab;
  - active job → confirm reset → page restored → zero tile/artifact/job;
  - visible result → reset → source/output/session bị xóa.
- Full baseline quality gate.

## 5.5 Exit criteria

- AC-25, AC-26, AC-27 pass.
- Không còn UI dead-end ở `ready`, `completed`, `failed`, `cancelled`.
- Reset không xóa settings hoặc file đã download.
- Không có stale tab lock sau reset.

# 6. S22 — Adaptive auto-scroll đến stable end

## 6.1 Mục tiêu

Tạo engine full-document mới có thể cuộn từ đầu đến cuối trang hữu hạn, chấp nhận chiều cao tăng do lazy-load và không dừng chỉ vì ngưỡng 100.000 CSS px.

## 6.2 Phạm vi code

- Thêm `AdaptiveScrollCaptureEngine`.
- Thêm adaptive frontier planner và stable-end detector pure modules.
- Persist frontier/progress cần thiết để report partial/recovery trung thực.
- Bắt đầu từ document top; capture row tuần tự với overlap/crop metadata.
- Remeasure sau mỗi scroll/settle.
- Growth là expected; width/DPR/pixel-scale drift vẫn fail.
- Kết thúc khi bottom + 3 stable rounds + final probe.
- Thay fixed CSS-height cap bằng resource budgets đã benchmark:
  - max duration;
  - max tile;
  - max stored bytes/quota;
  - storage pressure;
  - memory/export guard.
- User stop giữ contiguous prefix; cancel/reset discard.
- Reuse fixed/sticky ownership và exact restoration.
- Routing policy chọn adaptive engine cho “Toàn trang → PDF” khi cần scroll-visible capture hoặc CDP không chứng minh complete path.

## 6.3 Fixtures

- Static 30k.
- Static 100k.
- Static >100k.
- Lazy-growth hữu hạn nhiều đợt.
- Infinite growth guard.
- Fixed header/footer seam pattern.
- Width/DPR/layout instability negative cases.

## 6.4 Validation

- Stable-end detector unit matrix.
- Frontier monotonicity, exact final bottom và gap/overlap rejection.
- E2E auto-scroll from top regardless initial scroll position.
- E2E lazy page continues after height growth.
- E2E >100k complete.
- E2E infinite fixture surfaces explicit partial reason.
- Exact restoration on success/error/cancel/reset.
- Existing CDP and deterministic scroll fallback regressions remain green.

## 6.5 Exit criteria

- AC-19, AC-20, AC-21 pass.
- Không có silent truncation.
- Không recapture prefix khi page grows.
- Không tạo full-page canvas hoặc giữ nhiều decoded tile.

# 7. S23 — Auto-PDF và smart composition

## 7.1 Mục tiêu

Sau tiled capture hoàn tất, tự tạo PDF dùng preset hiện tại; editor trở thành tùy chọn thay vì bước bắt buộc.

## 7.2 Phạm vi code

- Thêm `CaptureCompletionPolicy` và migration.
- Full-page default: `autoExport: pdf`, `openEditorAfterCapture: false`.
- Coordinator tự gọi PDF export từ durable `ready` checkpoint.
- Idempotent restart handling ở `ready`; retry từ source tile nếu export failed.
- Result job `completed` chứa `outputArtifactId` và metadata PDF.
- Exporter consume logical output/crop/overlap metadata của adaptive tiles.
- Thêm seam-integrity validation:
  - no logical gap;
  - no duplicate strip;
  - exact final bottom;
  - stable page count/dimensions.
- Partial capture chỉ auto-export sau explicit keep.
- Main result actions: Download PDF, Edit pages, New capture.

## 7.3 Validation

- State orchestration unit tests.
- Restart at `ready` then auto-export exactly once.
- Export failure preserves source tile and retry avoids recapture.
- PDF signature, loadability, page count, page dimensions and image backing.
- Pattern fixture detects missing/duplicate seam.
- Memory metrics prove one page canvas và decoded concurrency ≤ 1.
- 30k, 100k, >100k và lazy-growth PDF benchmark references.

## 7.4 Exit criteria

- AC-22, AC-23, AC-24 pass.
- Basic full-page task completes without opening editor.
- PDF retry works after popup/browser surface reopen.
- Existing editor reorder/remove/settings/download remains functional.

# 8. S24 — Simplified popup và progressive disclosure

## 8.1 Mục tiêu

Tập trung popup vào hành động thực tế của người dùng; giữ thông tin kỹ thuật trong help/diagnostics.

## 8.2 Information architecture

Main flow:

1. Header WebCap.
2. Support/permission notice chỉ khi cần.
3. Goal selector:
   - Toàn trang → PDF;
   - Vùng cụ thể;
   - Màn hình hiện tại.
4. Submode region/element/scroll-area chỉ khi chọn Vùng cụ thể.
5. Primary CTA.
6. Phase progress.
7. Result actions.
8. Advanced options collapsed.

Move to Help & diagnostics:

- worker status/version;
- current-tab technical status;
- engine;
- raw tile count;
- checksums;
- full permission inventory;
- copy diagnostics.

Remove from end-user copy:

- milestone badges `M1/S14/S16/S17`;
- “available/unavailable” repeated under every mode;
- `x/? tile` in adaptive progress.

## 8.3 Phạm vi code

- Tách popup view model khỏi domain job state.
- Tách components: goal selector, target picker, phase progress, result card, advanced options, help diagnostics.
- PDF source card concise và conditional.
- New capture/reset integrated in every terminal result.
- Preserve vi/en i18n, keyboard navigation, focus recovery, live region, reduced motion.
- Update CSS for compact hierarchy, consistent spacing và popup height.

## 8.4 Validation

- Component/view-model unit tests.
- Keyboard-only capture/reset/download/help flow.
- Default popup assertions: no version, milestone badge, raw tile count, checksum.
- Diagnostics remains reachable and copyable.
- Restricted page and permission rationale still explicit.
- E2E full-page path requires one goal selection at most and one start click before progress.

## 8.5 Exit criteria

- AC-28, AC-29 pass.
- Không mất capability 0.1.0.
- Main CTA luôn rõ ở idle/result states.
- Không còn dead-end sau download hoặc editor close.

# 9. S25 — Hardening và release candidate 0.2.0

## 9.1 Mục tiêu

Khóa behavior 0.2.0, benchmark long/lazy pages, hoàn tất migration/docs và tạo release candidate reproducible mới.

## 9.2 Phạm vi

- Bump package/manifest version lên `0.2.0` chỉ trong S25.
- Update README, SPEC/PRD references, CHANGELOG, privacy, permissions, known limitations, manual testing, release checklist, release notes và acceptance traceability.
- Benchmark/lock resource budgets của adaptive engine.
- Validate upgrade từ 0.1.0 → 0.2.0 giữ settings/locale/storage hợp lệ.
- Re-run all privacy, dependency, release và security audits.
- Deterministic `webcap-0.2.0.zip` và checksum.
- Packaged install/update/uninstall trên Linux/Windows/macOS, minimum Chrome và stable.
- Không upload/submit/publish Chrome Web Store nếu chưa có approval riêng.

## 9.3 Release matrix tối thiểu

- Static 30k/100k/>100k.
- Lazy-growth hữu hạn.
- Infinite guard/partial.
- Region/element/scroll-area/visible regressions.
- PDF source original passthrough regressions.
- Reset terminal/active/interrupted.
- DPR `1/1.5/2` × zoom `80/100/125/150%` cho critical flows.
- Chrome 116 và current stable.

## 9.4 Exit criteria

- AC-01–AC-30 pass hoặc có documented non-MUST disposition được product owner chấp thuận.
- Zero P0/P1.
- Zero critical dependency advisory.
- Zero unresolved review thread.
- Package reproducible và packaged lifecycle pass.
- Store/publication boundary vẫn được tôn trọng.

# 10. Dependency graph

```text
S21 Reset lifecycle
  └─ provides cleanup/delete contracts
      ↓
S22 Adaptive auto-scroll
  └─ produces durable contiguous tile set
      ↓
S23 Auto-PDF
  └─ produces simple completed result contract
      ↓
S24 Popup redesign
  └─ consumes stable reset/capture/export contracts
      ↓
S25 Hardening/release
```

S24 không được bắt đầu trước khi result/reset contracts ổn định; tránh redesign UI hai lần theo contract thay đổi.

# 11. Quyết định mở cần benchmark trong S22/S23

Không cần hỏi lại người dùng trước khi bắt đầu session; implementation chọn giá trị an toàn và ghi evidence. Tuy nhiên các giá trị sau chưa được khóa cứng ở PR kế hoạch:

- max auto-scroll duration;
- max tile count;
- max stored bytes/quota policy;
- số stable rounds/final probe duration;
- ngưỡng seam fingerprint nếu cần visual overlap validation;
- preset PDF mặc định cuối cùng sau benchmark.

Mọi thay đổi khỏi đề xuất trong `docs/spec-0.2.0.md` phải được ghi trong PR body, SPEC và tests cùng session.

# 12. Current session handoff

**Current session: S21 — Reset lifecycle và “Chụp mới”.**

Khi bắt đầu triển khai:

1. Tạo branch `agent/s21-capture-reset` từ `main` sau khi PR kế hoạch được merge.
2. Đọc PRD v1.1, SPEC addendum và toàn bộ reset/cleanup repositories hiện tại.
3. Viết contract + service + tests trước khi nối UI.
4. Không triển khai adaptive scroll hoặc redesign popup ngoài nút tối thiểu cần nghiệm thu S21.
5. Mở draft PR và chỉ mark ready sau clean read-only CI.
