---
product: WebCap
document: Active Implementation Plan
version: 1.1
date: 2026-08-06
status: Release candidate validation
repository: quoctran-2608/WebCap
owner: OpenAI coding agent
prd: ./PRD_WebCap_v1.1.md
spec: ./docs/spec-0.2.0.md
audit: ./docs/audits/0.1.0-gap-audit.md
release_target: 0.2.0
current_session: S26-RC
---

# WebCap — Implementation plan 0.2.0

Roadmap `S00–S20` đã tạo release candidate 0.1.0. Roadmap mới `S21–S26` xử lý các khoảng trống thực tế: reset/chụp mới, region drawing có thể nhìn thấy và sử dụng được, adaptive auto-scroll, auto-PDF/output routing, settings/UI/progress và hardening release.

S21–S25 đã hoàn tất reset lifecycle, region selector đáng tin cậy, adaptive auto-scroll có resumable frontier, mode-aware output, stored settings, event-driven progress và simplified popup mà không thay manifest, package version hoặc artifact 0.1.0. S26 là session active tiếp theo.

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
| S21 | Reset lifecycle và “Chụp mới” | DONE | S20 |
| S22 | Region drawing launch, interaction và accessibility | DONE | S21 cleanup primitive |
| S23 | Adaptive auto-scroll và resumable frontier | DONE | S21–S22 |
| S24 | Auto-PDF và mode-aware image/PDF output | DONE | S23 |
| S25 | Stored settings, event-driven progress và simplified popup | DONE | S21–S24 stable contracts |
| S26 | Gap closure hardening, migration, docs và RC 0.2.0 | IN VALIDATION | S21–S25 |

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


## Implementation evidence

- Contract `CAPTURE_RESET` hỗ trợ scope `visible-session`, `job` và `tab`, response report versioned và request dedupe.
- `CaptureResetService` điều phối selector cancellation, active capture/PDF cancellation, `waitForIdle`, cleanup và idempotent missing-record behavior.
- `CaptureOwnedDataCleanupService` xóa edit manifest, output/source artifacts, tiles, job, summary và tab lock theo ownership; partial cleanup trả warning an toàn thay vì xóa mù.
- Visible image export và PDF export xử lý race: output hoàn tất muộn sau reset bị xóa và trả `E_CANCELLED`, không hồi sinh session/job.
- Popup có “Chụp mới” ở ready/completed/failed/cancelled và preview; reset active yêu cầu xác nhận.
- Region/element selector có typed close command để reset không để overlay orphan.
- Validation implementation: format, TypeScript strict, ESLint, 290/290 unit tests trên 83 files và production build pass.
- E2E mới xác minh visible result reset rồi capture lần hai; full-page terminal reset, tạo job thứ hai cùng tab và active reset phục hồi trang, xóa job/tile.

## Exit disposition

- AC-25, AC-26, AC-27: PASS khi full read-only CI của PR xanh.
- UX-RESET-001 và DATA-001 trong gap audit: CLOSED by S21.
- Settings, locale và downloaded files không thuộc reset ownership và được giữ nguyên.

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

## S22 implementation evidence

- Ready ACK chỉ được trả sau root attach, listener setup, dialog focus và first render.
- Popup chỉ đóng sau ACK; timeout/injection failure đi qua S21 reset và để lại zero orphan job/root/lease.
- Pointer create/move/eight-handle resize, two-axis edge auto-scroll và toolbar luôn tương tác được trên selection.
- Keyboard Space/toolbar create, arrows move, Alt resize, Shift acceleration, Enter commit và Escape cancel.
- Handle hit target tối thiểu 24 CSS px; selector bị remove và chờ hai animation frame trước capture.
- Final gate: formatting, ESLint, strict TypeScript, audits, 295/295 unit tests trên 84 files, 4/4 PDF benchmarks, verified build, reproducible ZIP, 44/44 Playwright E2E và packaged lifecycle smoke đều PASS.

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

## S23 implementation evidence

- Full-page jobs created by the 0.2 flow route to an incremental adaptive scroll engine; region and element retain the deterministic coordinator.
- The persisted frontier advances only after a complete row has durable tile Blobs. A partially stored row resumes only missing columns and is rolled back before any guard-limited partial result is exposed.
- Finite document growth is expected. Completion requires bottom reach, three stable rounds and a final probe; pages beyond 100,000 CSS pixels no longer stop at the legacy height cap.
- Duration, tile, byte-budget and storage failures preserve a rectangular contiguous prefix with an explicit partial reason.
- Document token, width, viewport and DPR guards prevent tiles from different page identities from being joined.
- Service-worker restart recovery reuses the durable prefix and re-prepares the same page. Cached page-preparation responses are re-enveloped with the current transport request ID to keep idempotency protocol-safe.
- Final clean gate: formatting, ESLint, strict TypeScript, privacy/dependency/release/critical-security audits, 306/306 unit tests on 88 files, 4/4 PDF benchmarks, verified build, reproducible ZIP, 48/48 Playwright E2E and packaged lifecycle smoke all PASS.

## Exit disposition

- AC-19, AC-20, AC-21 and AC-38: PASS.
- No arbitrary 100,000 CSS-pixel adaptive stop and no silent complete status for resource-limited output.
- PDF/output routing remains intentionally deferred to S24.

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


## S24 implementation evidence

- `CaptureCompletionPolicy` routes full-page and scroll-area jobs to automatic PDF export, region and element jobs to guarded image export, and leaves visible capture on its existing image flow.
- Auto-export begins only from the durable `ready` checkpoint. Output format, artifact ID, MIME type, byte length and PDF page count persist on the job; worker recovery reconciles an existing output before starting work again.
- `TiledImageExportService` validates dimensions, total pixel area and working-set budget before allocating an `OffscreenCanvas`, decodes tiles sequentially and emits PNG/JPEG/WebP without a full-page canvas.
- `E_IMAGE_OUTPUT_TOO_LARGE` preserves every source tile and exposes the explicit “Chuyển sang PDF không chụp lại” action. Browser coverage proves the same job and exact stored tile Blobs produce the fallback PDF without reopening a selector or recapturing pixels.
- Reopening the popup restores the most recent terminal output when no active job exists. Result cards expose the correct image/PDF metadata, download, supported edit and new-capture actions.
- Editing an auto-generated PDF explicitly reopens `completed → ready`, removes only the old output artifact, keeps source tiles and edit manifest consistency, then produces a replacement PDF without recapture.
- Partial capture is never auto-exported until the user explicitly keeps the contiguous prefix; cancellation/reset continue to discard capture-owned data.
- Final clean gate on commit `6d23173f0bebf8bc6ffd23327dacd7fb58322d47`: formatting, ESLint, strict TypeScript, privacy/dependency/release/critical-security audits, 325/325 unit tests on 92 files, 4/4 PDF benchmarks, verified Manifest V3 build, reproducible 24-entry ZIP, 49/49 Playwright E2E and packaged install/update/uninstall lifecycle all PASS.

## S24 exit disposition

- AC-22: PASS — successful full-page capture starts PDF export without opening the editor.
- AC-23: PASS — PDF remains page-at-a-time with decoded-tile concurrency bounded to one and no full-page canvas.
- AC-24: PASS — export failure preserves source tiles; retry and image-to-PDF fallback reuse them without recapture.
- AC-36: PASS — full-page/scroll-area default to PDF, region/element return direct guarded images and oversized images receive an explicit PDF fallback.
- S25 is unblocked and becomes the active session; stored settings, event-driven progress and simplified popup remain out of S24 scope.

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

## S25 implementation evidence

- `SettingsRepository` được load/migrate trước khi capture có thể bắt đầu; visible và mọi tiled mode dùng snapshot đã validate thay vì hard-coded defaults.
- Output preference được lưu riêng theo visible/full-page/region/element/scroll-area; image quality, PDF page size/orientation/margin/quality và fixed/sticky policy tồn tại qua popup reopen.
- “Đặt lại tùy chọn” chỉ reset capture preferences, không xóa job, tile, artifact, locale hoặc downloaded files.
- Popup nhận `JOB_SUMMARY_CHANGED` theo tab/job/revision và chỉ authoritative-fetch revision mới; polling 350 ms được thay bằng reconciliation 7,5 giây khi busy.
- Coordinator phát đúng một summary event cho mỗi revision qua update, cancellation và worker recovery; interrupted recovery không còn duplicate failed event.
- Main flow mặc định không hiển thị version, milestone, engine, checksum hoặc raw tile count. Technical status nằm trong disclosure; CTA đứng trước Advanced options và settings chỉ xuất hiện khi idle hoặc terminal, không xuất hiện khi busy.
- Keyboard/browser coverage khóa English localization, range controls, save/reset feedback atomic, disclosure order, privacy help và action recovery.
- Final clean gate: formatting, ESLint, strict TypeScript, privacy/dependency/release/critical-security audits, 344/344 unit tests trên 99 files, 4/4 PDF benchmarks, verified Manifest V3 build, reproducible 25-entry package, 51/51 Playwright E2E và packaged lifecycle smoke đều PASS.

## S25 exit disposition

- AC-28: PASS — default popup thu gọn worker/version/tab status và không hiển thị milestone, engine, checksum hoặc raw tile count trong main flow.
- AC-29: PASS — advanced settings, help/privacy disclosures và actions có native keyboard semantics; localized live feedback dùng polite atomic status.
- AC-35: PASS — stored format/quality/PDF/fixed-sticky settings được snapshot vào job và tồn tại qua popup reopen; options reset có ownership riêng.
- AC-37: PASS — runtime event cập nhật progress theo revision; 7,5-second authoritative reconciliation chỉ là fallback, không còn continuous 350 ms polling.
- S26 được mở khóa và trở thành active session cho gap closure, migration, release docs và RC 0.2.0.

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

## S26 implementation evidence

- Package and manifest are synchronized at version 0.2.0 while required permissions, optional host permissions, minimum Chrome 116 and the local-first boundary remain unchanged.
- Packaged lifecycle now simulates a real 0.1.0 → 0.2.0 update and verifies extension ID, capture settings, locale, unrelated local storage and newly initialized per-mode popup preferences.
- Release Candidate compatibility resolves and tests minimum Chrome, previous stable and current stable; Linux, Windows and macOS retain packaged lifecycle coverage.
- The 0.1.0 gap audit has final evidence/disposition for every MUST/SHOULD item; deferred items remain explicit 0.3+ scope rather than implicit omissions.
- S26 implementation gate: {{S26_RUN_EVIDENCE}}. Reproducible package: {{S26_PACKAGE_EVIDENCE}}.
- No tag, GitHub Release, Chrome Web Store upload, review submission or publication is performed.

## S26 exit disposition

- AC-01–AC-39 are covered by the retained and expanded unit, benchmark, actual-browser, privacy, permission and packaged lifecycle suites.
- AC-40 is pending the final read-only Release Candidate minimum/previous/current Chrome and OS matrix on the S26 PR.
- S26 remains IN VALIDATION until those permanent read-only workflows pass with zero P0/P1, critical advisory or unresolved review thread.

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

**Current session: S26 — Hardening, gap closure và release candidate 0.2.0.**

1. Bắt đầu từ baseline S21–S25 đã merge và giữ nguyên semantics reset/selector/adaptive/output/settings/events.
2. Rà `docs/audits/0.1.0-gap-audit.md`, acceptance AC-01–AC-40 và đóng mọi MUST/SHOULD bằng evidence hoặc disposition rõ.
3. Kiểm thử migration 0.1.0 → 0.2.0, compatibility matrix, deterministic package và packaged lifecycle trên các target đã định.
4. Chỉ bump package/manifest lên 0.2.0 trong S26; không thêm permission, backend, telemetry hoặc remote executable code.
5. Không tag, tạo GitHub Release, upload Chrome Web Store hoặc publish nếu chưa có approval riêng.
