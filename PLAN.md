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
audit: ./docs/audits/0.1.0-gap-audit.md
release_target: 0.2.0
current_session: S21
---

# WebCap — Implementation plan 0.2.0

Roadmap `S00–S20` đã tạo release candidate 0.1.0. Roadmap mới `S21–S26` xử lý các khoảng trống thực tế: reset/chụp mới, region drawing có thể nhìn thấy và sử dụng được, adaptive auto-scroll, auto-PDF/output routing, settings/UI/progress và hardening release.

PR kế hoạch chỉ cập nhật tài liệu. Không thay source, manifest, package version hoặc artifact 0.1.0.

# 1. Nguồn sự thật

- `PRD_WebCap_v1.0.md`: baseline AC-01–AC-18.
- `PRD_WebCap_v1.1.md`: delta 0.2.0, AC-19–AC-40.
- `SPEC.md`: baseline architecture/contracts.
- `docs/spec-0.2.0.md`: region, adaptive scroll, output, reset, settings, events và recovery.
- `docs/audits/0.1.0-gap-audit.md`: inventory vấn đề và disposition.
- `PLAN.md`: session, dependency, validation và exit criteria.
- `CHANGELOG.md`: chỉ cập nhật khi behavior thực sự đổi.

# 2. Nguyên tắc triển khai

- Mỗi PR hoàn thành một session có thể kiểm thử.
- Contract/storage trước UI sử dụng contract.
- Behavior và tests trong cùng PR.
- Không tuyên bố unlimited; bỏ CSS-height hard stop nhưng giữ resource budgets.
- Không backend, telemetry, account, cloud sync, remote code, required permission hoặc default host permission mới.
- Không full-page canvas; PDF page-at-a-time, image output chỉ dưới guard.
- Success/error/cancel/reset/recovery đều cleanup và restore trong finally-equivalent.
- Không thay artifact 0.1.0. Version 0.2.0 chỉ bump ở S26.

# 3. Baseline phải giữ xanh

- 279 unit tests / 79 files.
- 4 PDF benchmark scenarios.
- 38 Playwright E2E cases.
- Verified Manifest V3 build.
- Privacy, dependency/license, release metadata và critical-security audits.
- DPR `1/1.5/2` × zoom `80/100/125/150%` release matrix.
- Zero accepted P0/P1.

# 4. Roadmap 0.2.0

| Session | Capability | Status | Depends on |
| --- | --- | --- | --- |
| S21 | Reset lifecycle và “Chụp mới” | PLANNED | S20 |
| S22 | Region drawing launch, interaction và accessibility | BLOCKED | S21 cleanup primitive |
| S23 | Adaptive auto-scroll và resumable frontier | BLOCKED | S21 |
| S24 | Auto-PDF và mode-aware image/PDF output | BLOCKED | S23 |
| S25 | Stored settings, event-driven progress và simplified popup | BLOCKED | S21–S24 stable contracts |
| S26 | Gap closure hardening, migration, docs và RC 0.2.0 | BLOCKED | S21–S25 |

# 5. S21 — Reset lifecycle và “Chụp mới”

## Mục tiêu

Cho phép bỏ capture hiện tại và bắt đầu lại ở mọi state; tạo cleanup primitive dùng chung cho reset, expiry và selector launch failure.

## Phạm vi

- `CAPTURE_RESET` contract và report versioned.
- `CaptureResetService` ở background.
- Delete theo capture ownership: job, tiles, source/output artifacts, thumbnails, edit manifest, summary, lock, visible session.
- Terminal reset: cleanup local data và unlock tab.
- Active reset: confirm → cancel → restore → discard.
- Dedupe theo requestId; missing record success idempotent.
- Reuse primitive trong expiry cleanup.
- Nút “Chụp mới” tối thiểu trong UI hiện tại.
- Command riêng để reset settings; không trộn với capture reset.

## Validation

- Contract/parser/router/service/repository unit tests.
- Terminal, active, missing, duplicate, partial cleanup, isolation.
- E2E visible và tiled reset, capture lần hai cùng tab.
- No stale lock/job/tile/artifact.

## Exit

- AC-25–AC-27 pass.
- Không còn dead-end terminal.
- Settings, locale và downloaded files được giữ.

# 6. S22 — Region drawing launch và reliability

## Mục tiêu

Bấm “Vẽ vùng chọn” phải tạo một hành trình rõ ràng: popup đóng, overlay xuất hiện ngay, pointer/keyboard tạo rectangle được và kết quả không chứa UI selector.

## Phạm vi

- Ready handshake chỉ success sau root attach, stage focus, listeners và first render.
- Popup `window.close()` sau ready ACK.
- Launch timeout/error dùng S21 cleanup; zero orphan job/root/lock.
- Copy hướng dẫn ngắn và visible crosshair/dim mask.
- Pointer create/move/eight-handle resize/auto-scroll.
- Handle hit target ≥24 CSS px.
- Keyboard creation bằng Space hoặc toolbar fallback; move/resize shortcuts.
- Enter commit, Escape cancel.
- Duplicate open atomic và một selector root duy nhất.
- Selector removed + two RAF before capture.
- Region result default PNG; output implementation hoàn tất trong S24.

## Fixtures

- Standard region page.
- Long region beyond viewport.
- Wide region with horizontal auto-scroll.
- Launch injection failure.
- Duplicate start.
- Focus/keyboard fixture.
- DPR/zoom fixture.

## Validation

- Unit coordinate/keyboard/handshake/timeout cleanup.
- Headed/package E2E từ action popup: click → popup closed → overlay visible ≤500 ms.
- Pointer and keyboard complete flows.
- Exact CSS document rectangle.
- Overlay pixel exclusion.
- Restore scroll/focus/styles on confirm/cancel/error.

## Exit

- AC-31–AC-34 pass.
- User không cần click ra ngoài popup hoặc đoán bước tiếp theo.
- No orphan selector/job.

# 7. S23 — Adaptive auto-scroll và resumable frontier

## Mục tiêu

Chụp finite page từ đầu đến stable end, kể cả >100k và lazy growth; worker restart không làm mất prefix đã lưu.

## Phạm vi

- `AdaptiveScrollCaptureEngine`.
- Adaptive frontier planner và stable-end detector.
- Persist frontier sau mỗi stored tile.
- Start `y=0`, remeasure sau mỗi scroll/settle.
- Height growth expected; width/DPR/pixel-scale drift fail.
- Bottom + 3 stable rounds + final probe.
- Resource budgets: duration, tile, stored bytes/quota, storage pressure, memory.
- User stop giữ contiguous prefix; cancel/reset discard.
- Resume service revalidate document token/viewport/DPR/frontier.
- Valid restart resumes; invalid restart gives Keep/Restart/Reset partial flow.
- Existing CDP engine giữ nguyên; routing chọn adaptive khi cần visible scrolling/lazy growth hoặc fallback.

## Fixtures

- Static 30k, 100k, >100k.
- Finite lazy growth nhiều đợt.
- Infinite guard.
- Fixed/sticky seam.
- Restart after N tiles.
- Navigation/document/DPR drift negative cases.

## Validation

- Stable detector and frontier unit matrix.
- No gap/duplicate/recapture prefix.
- Actual browser capture for 30k/100k/>100k.
- Restart resume/partial disposition.
- Exact restoration on all exits.

## Exit

- AC-19–AC-21 và AC-38 pass.
- Không silent truncation.
- Không full-page canvas/multi-tile decode.

# 8. S24 — Auto-PDF và mode-aware output

## Mục tiêu

Mỗi capture mode kết thúc bằng output hợp lý mà không bắt người dùng hiểu tile/editor.

## Output defaults

- Full-page: PDF, auto export.
- Scroll-area: PDF; image option khi dưới guard.
- Region: PNG; JPEG/WebP; PDF fallback nếu quá lớn.
- Element: PNG; JPEG/WebP; PDF fallback nếu quá lớn.
- Visible: existing image flow.

## Phạm vi

- `CaptureCompletionPolicy` + migration.
- Coordinator auto export từ durable `ready` checkpoint.
- Auto-export idempotent after restart.
- `TiledImageExportService` bounded by pixel/canvas/memory guard.
- PDF exporter consume adaptive logical crop/overlap.
- Seam integrity: no gap, no duplicate strip, exact bottom.
- Partial output only after explicit keep.
- Result contract: artifact ID/type/size, Download, Edit when supported, New capture.
- Typed `E_IMAGE_OUTPUT_TOO_LARGE` → “Xuất PDF”.

## Validation

- State orchestration and exactly-once auto export.
- Export failure preserves tiles; retry no recapture.
- PDF signature/page count/dimensions/image backing.
- PNG/JPEG/WebP guarded image output.
- Seam fingerprint fixture.
- Memory metrics: PDF decoded concurrency ≤1; image canvas only after guard.

## Exit

- AC-22–AC-24 và AC-36 pass.
- Region/element có result ảnh trực tiếp trong safe cases.
- Basic full-page completes without editor.

# 9. S25 — Settings, events và simplified popup

## Mục tiêu

Biến stored settings thành nguồn sự thật, bỏ polling ngắn và tập trung popup vào mục tiêu người dùng.

## Settings

- Load/migrate settings before create job.
- `startTiledCapture` nhận validated settings, không override bằng defaults.
- Persist per-mode output, image quality, PDF size/orientation/margin/quality, fixed/sticky policy.
- Advanced options collapsed.
- “Đặt lại tùy chọn” riêng.

## Event-driven progress

- Subscribe `JOB_PROGRESS`, `JOB_STATE_CHANGED`, `VISIBLE_SESSION_CHANGED`, `SELECTOR_STATE_CHANGED`, `CAPTURE_RESET_COMPLETED`.
- Authoritative fetch on initial open, missed revision, reconnect.
- Busy reconciliation 5–10 seconds; không 350 ms polling liên tục.

## Information architecture

1. Header + Help.
2. Conditional support/permission notice.
3. Goal selector: Full page → PDF; Specific area; Current screen.
4. Target picker: Draw rectangle; Select element; Select scroll area.
5. Primary CTA.
6. Phase progress/result.
7. Advanced options.
8. Help & diagnostics.

Move out of main flow: worker/version, engine, raw tiles, checksum, milestones, permission inventory, copy diagnostics. PDF inspection không gây checking-card flicker trên non-PDF tab.

## Validation

- Settings persistence/migration/default reset.
- Event revision/reconciliation tests.
- Component/view-model unit tests.
- Keyboard capture/reset/download/help/settings.
- Main popup assertions exclude technical copy.
- Restricted page/permission guidance remains explicit.

## Exit

- AC-28, AC-29, AC-35, AC-37 pass.
- Main CTA rõ ở idle/result.
- Không mất capability 0.1.0.

# 10. S26 — Hardening, gap closure và release candidate

## Mục tiêu

Khóa behavior, đóng audit items đã chọn, cập nhật docs và tạo RC 0.2.0 reproducible.

## Phạm vi

- Review `docs/audits/0.1.0-gap-audit.md`: mọi MUST/SHOULD có evidence hoặc disposition.
- Bump package/manifest lên 0.2.0 chỉ tại đây.
- Update README, PRD/SPEC refs, CHANGELOG, privacy, permissions, known limitations, manual testing, release checklist/notes/acceptance traceability.
- Benchmark và khóa adaptive budgets.
- Upgrade 0.1.0 → 0.2.0 giữ settings/locale hợp lệ.
- Full audits và regression.
- Deterministic ZIP/checksum.
- Packaged lifecycle Linux/Windows/macOS.
- Chrome minimum, current stable và previous stable.
- Không upload/submit/publish Store nếu chưa approval.

## Release matrix

- Static 30k/100k/>100k actual-browser.
- Finite lazy growth và infinite partial.
- Region popup-to-overlay pointer/keyboard.
- Element/scroll-area/visible regressions.
- PDF original passthrough.
- Reset terminal/active/interrupted.
- Worker restart resume/partial.
- DPR/zoom critical flows.

## Exit

- AC-01–AC-40 pass hoặc non-MUST disposition được owner chấp thuận.
- Zero P0/P1, critical advisory và unresolved review thread.
- Reproducible package và lifecycle pass.
- Platform limitations được Help/docs mô tả trung thực.

# 11. Defer và platform boundaries

Không kéo vào core 0.2.0 trừ khi S21–S25 hoàn tất sớm:

- advanced crop editor;
- original PDF page range;
- one-long-page PDF;
- annotation/OCR/search;
- batch/cloud integrations/history.

Không workaround trái nền tảng cho restricted surfaces, DRM, cross-origin DOM, closed shadow root, file permission hoặc source-tab-active requirement.

# 12. Dependency graph

```text
S21 Reset/cleanup
 ├─→ S22 Region selector launch
 └─→ S23 Adaptive/resume
       ↓
     S24 Auto output
       ↓
     S25 Settings/events/UI
       ↓
     S26 Hardening/release
```

# 13. Current session handoff

**Current session: S21 — Reset lifecycle và “Chụp mới”.**

1. Merge PR kế hoạch sau review.
2. Tạo `agent/s21-capture-reset` từ `main`.
3. Viết contract/service/tests trước UI.
4. Không triển khai selector/adaptive/export/redesign ngoài scope S21.
5. Draft PR; mark ready chỉ sau clean read-only CI.
