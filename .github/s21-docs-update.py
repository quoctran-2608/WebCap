from pathlib import Path

plan = Path("PLAN.md")
text = plan.read_text()
text = text.replace("status: Planned", "status: Active", 1)
text = text.replace("current_session: S21", "current_session: S22", 1)
text = text.replace(
    "PR kế hoạch chỉ cập nhật tài liệu. Không thay source, manifest, package version hoặc artifact 0.1.0.",
    "S21 triển khai reset/chụp mới mà không thay manifest, package version hoặc artifact 0.1.0. S22 là session active tiếp theo.",
)
text = text.replace(
    "| S21 | Reset lifecycle và “Chụp mới” | PLANNED | S20 |\n| S22 | Region drawing launch, interaction và accessibility | BLOCKED | S21 cleanup primitive |",
    "| S21 | Reset lifecycle và “Chụp mới” | DONE | S20 |\n| S22 | Region drawing launch, interaction và accessibility | PLANNED | S21 cleanup primitive |",
)
marker = "\n# 6. S22 — Region drawing launch và reliability\n"
evidence = """

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
"""
if "## Implementation evidence" not in text:
    text = text.replace(marker, evidence + marker)
plan.write_text(text)

spec = Path("docs/spec-0.2.0.md")
text = spec.read_text()
if "# 10. S21 implementation lock" not in text:
    text += """

# 10. S21 implementation lock

S21 khóa các quyết định reset sau; session sau không được thay semantics nếu không có ADR và migration riêng.

## 10.1 Contract và idempotency

- Message `CAPTURE_RESET` version 1 có ba scope: `visible-session`, `job`, `tab`.
- Payload chỉ cho phép disposition `discard-local-data`; không truyền binary, URL hoặc page content.
- Response trả counters theo ownership, trạng thái cancellation và optional safe warning.
- Router dùng request dedupe hiện có; replay cùng `requestId` trả cùng response mà không xóa lần hai.
- Job/session đã mất được coi là success idempotent.

## 10.2 Active-reset ordering

Thứ tự bắt buộc:

1. đóng selector thuộc job nếu có;
2. yêu cầu capture hoặc PDF export cancel;
3. chờ coordinator `waitForIdle` để callback bất đồng bộ dừng;
4. chạy page/engine cleanup và restore;
5. xóa manifest, artifacts, tiles, job, summary và lock;
6. trả report, kèm `E_CLEANUP_PARTIAL` nếu một bước best-effort không hoàn tất.

Không được xóa local records trước khi tác vụ active dừng, vì callback muộn có thể ghi lại output hoặc job state.

## 10.3 Late-output protection

- Image/PDF output hoàn tất sau reset phải tự xóa artifact vừa tạo và trả `E_CANCELLED`.
- Reset visible xóa mọi artifact có `jobId` bằng source capture ID, không chỉ output đang hiển thị.
- Reset không xóa settings, locale hoặc file đã được Chrome Downloads lưu ra ngoài extension storage.

## 10.4 Shared cleanup primitive

`CaptureOwnedDataCleanupService` là primitive duy nhất cho user reset và được tái sử dụng dần bởi expiry/launch-failure cleanup. Ownership boundary gồm PDF edit manifest, thumbnail/output/source artifacts, tiles, job, metadata summary và exact matching tab lock. Không xóa record của job khác chỉ vì cùng tab.
"""
spec.write_text(text)

readme = Path("README.md")
text = readme.read_text()
text = text.replace(
    "**0.2.0 is planned, not implemented.** The active roadmap begins with S21 capture reset, then S22 region-selector launch/reliability, S23 adaptive auto-scroll and restart recovery, S24 automatic PDF and guarded tiled-image output, S25 settings/events/popup simplification, and S26 release hardening.",
    "**0.2.0 implementation is active. S21 capture reset is complete; S22 region-selector launch/reliability is next.** S21 adds a versioned reset domain command, owned-data cleanup, active-task quiescence, late-output protection and a visible “New capture” action without changing the 0.1.0 package boundary. S23–S26 remain planned for adaptive auto-scroll, mode-aware output, settings/events/UI and release hardening.",
)
readme.write_text(text)

changelog = Path("CHANGELOG.md")
text = changelog.read_text()
text = text.replace(
    "## [Unreleased]\n\nNo unreleased changes.",
    """## [Unreleased]

### Added

- Versioned `CAPTURE_RESET` flow for visible sessions, persistent jobs and active-tab scope with request deduplication and idempotent missing-record behavior.
- Shared capture-owned cleanup covering source/output artifacts, tiles, PDF edit manifests, job records, session summaries and exact tab locks.
- User-facing “New capture” actions for preview and every terminal tiled state, plus confirmation before discarding an active capture.
- Reset-safe selector close commands and active capture/PDF/image-export quiescence so late callbacks cannot recreate deleted state.
- S21 unit and browser coverage for terminal reset, active reset, partial cleanup, replay safety, late image output, page restoration and immediate second capture on the same tab.""",
)
changelog.write_text(text)

manual = Path("docs/manual-testing.md")
text = manual.read_text()
if "## S21 capture reset and new-capture validation" not in text:
    text += """

## S21 capture reset and new-capture validation

1. Create a visible PNG preview, then click **Chụp mới**. Confirm the preview disappears, the success notice is announced, `webcap.visible-session` is absent and the IndexedDB artifact store contains no records owned by that capture.
2. Without reloading the extension, create a second visible preview on the same tab. Confirm it receives a different artifact ID and succeeds normally.
3. Complete a full-page capture to `ready`, click **Chụp mới**, and inspect IndexedDB: the job, tiles, PDF edit manifest and owned artifacts are gone; the per-tab session lock is released.
4. Start another full-page capture on the same tab. While it is preparing/capturing, click **Hủy và chụp mới**, accept the confirmation, and verify the original scroll, focus, document/body styles and WebCap preparation/selector roots are restored.
5. Repeat reset after `failed`, `cancelled` and PDF `completed` states. Every state must return to an enabled capture action without reloading the popup.
6. Retry the same reset request ID from an extension test context. The second response must equal the first and must not delete unrelated jobs or artifacts.
7. Force one cleanup repository to fail. The reset report must contain safe `E_CLEANUP_PARTIAL` guidance while all remaining cleanup operations still execute.
8. Delay image/PDF processing, issue reset, then allow processing to finish. The late output must be deleted and the operation must settle as `E_CANCELLED`; no session/job may reappear.
9. Confirm settings, language and files already present in Chrome Downloads remain unchanged.

Automated coverage is in `tests/unit/capture-reset-*.test.ts`, `tests/unit/capture-data-cleanup-service.test.ts`, the late-output exporter tests and `tests/e2e/capture-reset.spec.ts`.
"""
manual.write_text(text)

session_dir = Path("docs/sessions")
session_dir.mkdir(parents=True, exist_ok=True)
(session_dir / "s21-capture-reset.md").write_text("""# S21 — Capture reset and new-capture lifecycle

Status: DONE pending merge of PR #26  
Target release: WebCap 0.2.0

## Delivered

- Typed reset request/response contracts for visible session, job and tab scopes.
- Central reset orchestration and capture-owned cleanup services.
- Safe cancellation and idle waiting for active full-page, scroll-area, PDF and visible-image work.
- Selector close messages for region and element selection.
- Late image/PDF output deletion after reset.
- Minimal popup actions for active and terminal reset states.

## Safety invariants

- Never delete another job because it shares a tab.
- Never delete settings, locale or downloaded files.
- Never remove persistent data before active work has reached an idle boundary.
- Never present partial cleanup as complete without a warning.
- Replaying a reset request is safe.

## Evidence

- Format, strict TypeScript, ESLint and production build: PASS.
- Unit: 290/290 across 83 files before E2E/document synchronization.
- Added E2E: visible reset and second capture; terminal and active full-page reset with page restoration and zero stale job/tile data.
- Full repository read-only CI, audits, PDF benchmarks, E2E and packaged lifecycle are the final merge gate.

## Deferred by scope

Adaptive scrolling, selector visual redesign, automatic PDF orchestration, settings source-of-truth and popup information architecture remain S22–S25 work.
""")
