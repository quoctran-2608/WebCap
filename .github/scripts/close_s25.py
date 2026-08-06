from pathlib import Path
from textwrap import dedent


def block(value: str) -> str:
    return dedent(value)


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    content = file.read_text()
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:100]!r}")
    file.write_text(content.replace(old, new, 1))


app = "src/popup/App.tsx"
replace_once(
    app,
    block(
        """\
  const canCapture =
    settingsReady &&
    workerStatus === "connected" &&
    tabCapability.status === "supported" &&
    selectedModeEnabled &&
    !busy;
"""
    ),
    block(
        """\
  const canCapture =
    settingsReady &&
    workerStatus === "connected" &&
    tabCapability.status === "supported" &&
    selectedModeEnabled &&
    !busy;
  const showAdvancedSettings =
    settingsReady &&
    !busy &&
    (tiledMode
      ? fullPageJob === undefined
      : status === "idle" && session?.artifact === undefined);
"""
    ),
)
replace_once(
    app,
    block(
        """\
      <section className="status-card" aria-label={t(locale, "popup.extensionStatus")}>
        <div className="status-row">
          <span>{t(locale, "popup.workerLabel")}</span>
          <strong
            className={`status status--${workerStatus}`}
            data-testid="worker-status"
            data-status={workerStatus}
          >
            <span className="status__dot" aria-hidden="true" />
            {workerStatusCopy(locale, workerStatus)}
          </strong>
        </div>
        <div className="status-row">
          <span>{t(locale, "popup.version")}</span>
          <strong>{workerVersion ?? chrome.runtime.getManifest().version}</strong>
        </div>
        <div className="status-row">
          <span>{t(locale, "popup.currentTab")}</span>
          <strong
            className={`status status--${tabCapability.status === "supported" ? "connected" : "pending"}`}
            data-testid="tab-status"
            data-status={tabCapability.status}
          >
            {tabStatusCopy(locale, tabCapability.status)}
          </strong>
        </div>
      </section>
"""
    ),
    block(
        """\
      <details className="status-details" data-testid="extension-status-details">
        <summary>{t(locale, "popup.extensionStatus")}</summary>
        <section className="status-card" aria-label={t(locale, "popup.extensionStatus")}>
          <div className="status-row">
            <span>{t(locale, "popup.workerLabel")}</span>
            <strong
              className={`status status--${workerStatus}`}
              data-testid="worker-status"
              data-status={workerStatus}
            >
              <span className="status__dot" aria-hidden="true" />
              {workerStatusCopy(locale, workerStatus)}
            </strong>
          </div>
          <div className="status-row">
            <span>{t(locale, "popup.version")}</span>
            <strong>{workerVersion ?? chrome.runtime.getManifest().version}</strong>
          </div>
          <div className="status-row">
            <span>{t(locale, "popup.currentTab")}</span>
            <strong
              className={`status status--${tabCapability.status === "supported" ? "connected" : "pending"}`}
              data-testid="tab-status"
              data-status={tabCapability.status}
            >
              {tabStatusCopy(locale, tabCapability.status)}
            </strong>
          </div>
        </section>
      </details>
"""
    ),
)
replace_once(app, '            <span className="planned-badge">S17</span>\n', "")
replace_once(
    app,
    block(
        """\
          <span className="planned-badge">
            {selectedMode === "visible" ? "M1" : selectedMode === "scroll-area" ? "S16" : "S14"}
          </span>
"""
    ),
    "",
)
replace_once(
    app,
    block(
        """\
        <AdvancedSettingsPanel
          locale={locale}
          settings={captureSettings}
          busy={busy}
          saving={settingsSaving}
          notice={settingsNotice}
          onSave={handleSaveCaptureSettings}
          onReset={handleResetOptions}
        />

"""
    ),
    "",
)
replace_once(
    app,
    block(
        """\
              <small>
                {fullPageJob.completedTiles}/{fullPageJob.totalTiles || "?"} tile ·{" "}
                {fullPageProgress}%
              </small>
"""
    ),
    "              <small>{fullPageProgress}%</small>\n",
)
replace_once(
    app,
    block(
        """\
        {resetNotice !== undefined && (
          <p className="feedback feedback--success" role="status" data-testid="reset-success">
            {resetNotice}
          </p>
        )}
      </section>
"""
    ),
    block(
        """\
        {resetNotice !== undefined && (
          <p className="feedback feedback--success" role="status" data-testid="reset-success">
            {resetNotice}
          </p>
        )}

        {showAdvancedSettings && (
          <AdvancedSettingsPanel
            locale={locale}
            settings={captureSettings}
            busy={busy}
            saving={settingsSaving}
            notice={settingsNotice}
            onSave={handleSaveCaptureSettings}
            onReset={handleResetOptions}
          />
        )}
      </section>
"""
    ),
)

css = "src/popup/popup.css"
replace_once(
    css,
    block(
        """\
.status-card {
  display: grid;
  padding: 6px 14px;
}
"""
    ),
    block(
        """\
.status-details {
  overflow: hidden;
  border: 1px solid rgb(23 58 45 / 10%);
  border-radius: 14px;
  background: rgb(255 255 255 / 72%);
}

.status-details > summary {
  padding: 10px 12px;
  color: #52645a;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.status-details > summary:focus-visible {
  outline: 3px solid rgb(189 143 60 / 36%);
  outline-offset: -3px;
}

.status-details[open] > summary {
  border-bottom: 1px solid rgb(23 58 45 / 8%);
}

.status-card {
  display: grid;
  padding: 6px 14px;
}

.status-details > .status-card {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
"""
    ),
)
replace_once(
    css,
    block(
        """\
.planned-badge {
  border-radius: 999px;
  padding: 5px 9px;
  color: #806d37;
  background: #f5edd7;
  font-size: 10px;
  font-weight: 700;
}

"""
    ),
    "",
)

test = "tests/e2e/popup-settings-accessibility.spec.ts"
replace_once(
    test,
    block(
        """\
  await popup.getByTestId("locale-select").selectOption("en");

  const details = popup.getByTestId("advanced-settings");
"""
    ),
    block(
        """\
  await popup.getByTestId("locale-select").selectOption("en");

  const extensionStatus = popup.getByTestId("extension-status-details");
  await expect(extensionStatus).not.toHaveAttribute("open", "");
  await expect(popup.getByText("Version", { exact: true })).not.toBeVisible();
  await expect(popup.getByText(/^(M1|S14|S16|S17)$/u)).toHaveCount(0);

  const details = popup.getByTestId("advanced-settings");
"""
    ),
)
replace_once(
    test,
    block(
        """\
  const summary = details.locator("summary");
  await expect(summary).toHaveText("Advanced options");
  await expect(details).not.toHaveAttribute("open", "");

  await summary.focus();
"""
    ),
    block(
        """\
  const summary = details.locator("summary");
  await expect(summary).toHaveText("Advanced options");
  await expect(details).not.toHaveAttribute("open", "");

  const captureAction = popup.locator(".capture-panel > button.primary-action");
  await expect(captureAction).toBeVisible();
  const captureBox = await captureAction.boundingBox();
  const settingsBox = await details.boundingBox();
  expect(captureBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  expect(captureBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
    settingsBox?.y ?? Number.NEGATIVE_INFINITY,
  );

  await summary.focus();
"""
    ),
)
replace_once(
    test,
    block(
        """\
  await expect(reset).toBeEnabled();
  await expect(imageQuality).toHaveValue("90");
});
"""
    ),
    block(
        """\
  await expect(reset).toBeEnabled();
  await expect(imageQuality).toHaveValue("90");

  const privacy = popup.locator(".trust-details");
  const privacySummary = privacy.locator("summary");
  await privacySummary.focus();
  await popup.keyboard.press("Enter");
  await expect(privacy).toHaveAttribute("open", "");
});
"""
    ),
)

plan = "PLAN.md"
replace_once(plan, "date: 2026-08-05", "date: 2026-08-06")
replace_once(plan, "current_session: S25", "current_session: S26")
replace_once(
    plan,
    "S21–S24 đã hoàn tất reset lifecycle, region selector đáng tin cậy, adaptive auto-scroll có resumable frontier và mode-aware output mà không thay manifest, package version hoặc artifact 0.1.0. S25 là session active tiếp theo.",
    "S21–S25 đã hoàn tất reset lifecycle, region selector đáng tin cậy, adaptive auto-scroll có resumable frontier, mode-aware output, stored settings, event-driven progress và simplified popup mà không thay manifest, package version hoặc artifact 0.1.0. S26 là session active tiếp theo.",
)
replace_once(
    plan,
    "| S25 | Stored settings, event-driven progress và simplified popup | PLANNED | S21–S24 stable contracts |\n| S26 | Gap closure hardening, migration, docs và RC 0.2.0 | BLOCKED | S21–S25 |",
    "| S25 | Stored settings, event-driven progress và simplified popup | DONE | S21–S24 stable contracts |\n| S26 | Gap closure hardening, migration, docs và RC 0.2.0 | PLANNED | S21–S25 |",
)
replace_once(
    plan,
    block(
        """\
## Exit

- AC-28, AC-29, AC-35, AC-37 pass.
- Main CTA rõ ở idle/result.
- Không mất capability 0.1.0.

# 10. S26 — Hardening, gap closure và release candidate
"""
    ),
    block(
        """\
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
- Main flow mặc định không hiển thị version, milestone, engine, checksum hoặc raw tile count. Technical status nằm trong disclosure; CTA đứng trước Advanced options và settings chỉ xuất hiện ở idle.
- Keyboard/browser coverage khóa English localization, range controls, save/reset feedback atomic, disclosure order, privacy help và action recovery.
- Final clean gate: formatting, ESLint, strict TypeScript, privacy/dependency/release/critical-security audits, 344/344 unit tests trên 99 files, 4/4 PDF benchmarks, verified Manifest V3 build, reproducible 25-entry package, 51/51 Playwright E2E và packaged lifecycle smoke đều PASS.

## S25 exit disposition

- AC-28: PASS — default popup thu gọn worker/version/tab status và không hiển thị milestone, engine, checksum hoặc raw tile count trong main flow.
- AC-29: PASS — advanced settings, help/privacy disclosures và actions có native keyboard semantics; localized live feedback dùng polite atomic status.
- AC-35: PASS — stored format/quality/PDF/fixed-sticky settings được snapshot vào job và tồn tại qua popup reopen; options reset có ownership riêng.
- AC-37: PASS — runtime event cập nhật progress theo revision; 7,5-second authoritative reconciliation chỉ là fallback, không còn continuous 350 ms polling.
- S26 được mở khóa và trở thành active session cho gap closure, migration, release docs và RC 0.2.0.

# 10. S26 — Hardening, gap closure và release candidate
"""
    ),
)
replace_once(
    plan,
    block(
        """\
# 13. Current session handoff

**Current session: S23 — Adaptive auto-scroll và resumable frontier.**

1. Bắt đầu từ baseline S22 đã merge.
2. Viết frontier/stable-end contracts và persistence trước engine/UI.
3. Kiểm thử actual-browser 30k/100k/>100k, finite lazy growth, infinite guard và worker restart.
4. Giữ nguyên S21 cleanup và S22 selector semantics.
5. Không kéo S24 output routing hoặc S25 popup redesign vào scope S23.
"""
    ),
    block(
        """\
# 13. Current session handoff

**Current session: S26 — Hardening, gap closure và release candidate 0.2.0.**

1. Bắt đầu từ baseline S21–S25 đã merge và giữ nguyên semantics reset/selector/adaptive/output/settings/events.
2. Rà `docs/audits/0.1.0-gap-audit.md`, acceptance AC-01–AC-40 và đóng mọi MUST/SHOULD bằng evidence hoặc disposition rõ.
3. Kiểm thử migration 0.1.0 → 0.2.0, compatibility matrix, deterministic package và packaged lifecycle trên các target đã định.
4. Chỉ bump package/manifest lên 0.2.0 trong S26; không thêm permission, backend, telemetry hoặc remote executable code.
5. Không tag, tạo GitHub Release, upload Chrome Web Store hoặc publish nếu chưa có approval riêng.
"""
    ),
)

spec = "docs/spec-0.2.0.md"
replace_once(spec, "date: 2026-08-05", "date: 2026-08-06")
replace_once(
    spec,
    "# 9. Test strategy\n",
    block(
        """\
## 8.3 Locked S25 implementation semantics

- Capture settings are loaded and migrated before capture controls become actionable. Repository read failure is typed and does not silently create a job from defaults.
- Per-mode output preferences are durable for visible, full-page, region, element and scroll-area modes. Reset options restores only preferences and preserves capture-owned data, locale and downloaded files.
- Background publishes validated `JOB_SUMMARY_CHANGED` events. Popup accepts only a newer revision for the current tab/job and performs an authoritative fetch; a 7.5-second busy reconciliation timer covers missed events or reconnect.
- Every coordinator session synchronization publishes at most one event for a revision. Interrupted worker recovery defers synchronization to the outer recovery pass, preventing duplicate failed events.
- Default popup information hierarchy is goal/mode → output hint → primary action → progress/result. Advanced settings follow the CTA and render only while idle; help, privacy, diagnostics and worker/version/tab status use progressive disclosure.
- Milestone labels, engine identifiers, checksum and raw tile counts are not rendered in the default main flow. Restricted-page and optional-permission guidance remain explicit when relevant.
- S25 acceptance evidence is 344 unit tests across 99 files, four bounded PDF benchmarks, 51 actual-browser E2E cases, a reproducible 25-entry package and packaged lifecycle smoke.

# 9. Test strategy
"""
    ),
)

readme = "README.md"
replace_once(
    readme,
    "**0.2.0 implementation is active. S21 capture reset, S22 region-selector reliability, S23 adaptive auto-scroll and S24 automatic mode-aware output are complete; S25 settings/events/simplified popup is next.** Full-page and scroll-area captures now create PDF automatically, while region and element captures create guarded PNG/JPEG/WebP output. Durable result metadata survives popup reopen and service-worker restart, auto-generated PDFs remain editable without recapture, and oversized image output offers an explicit PDF fallback that reuses the same stored tiles. S25–S26 remain planned for stored settings, event-driven progress, popup simplification and release hardening.",
    "**0.2.0 implementation is active. S21 capture reset, S22 region-selector reliability, S23 adaptive auto-scroll, S24 automatic mode-aware output and S25 stored settings/event-driven simplified popup are complete; S26 release hardening is next.** New jobs use durable per-mode output and quality/PDF/fixed-sticky preferences, popup progress is event-driven with slow authoritative reconciliation, and technical worker/version/diagnostics information is progressively disclosed behind the user capture flow. The 0.1.0 artifact and package version remain unchanged until S26 deliberately prepares the 0.2.0 release candidate.",
)
replace_once(
    readme,
    block(
        """\
- Remaining in S25: apply stored format, quality, PDF and fixed/sticky preferences to every new job.
- Remaining in S25: replace continuous 350 ms polling with event-driven progress and slow reconciliation.
- Remaining in S25: simplify the popup around capture goals, progress, download, edit and new capture; move technical details to help and diagnostics.
- No backend, telemetry, remote executable code, new required permission or default host permission.
"""
    ),
    block(
        """\
- Delivered in S25: durable per-mode output plus image/PDF/fixed-sticky preferences are loaded before capture, snapshotted into each new job and reset independently from capture data.
- Delivered in S25: validated runtime job-summary events replace continuous 350 ms polling; a 7.5-second authoritative reconciliation remains for missed events and reconnect.
- Delivered in S25: the primary capture action precedes idle-only advanced settings, while version, milestones, raw tile counts, privacy help and diagnostics no longer compete in the default main flow.
- Remaining in S26: acceptance gap closure, 0.1.0 → 0.2.0 migration, compatibility/release documentation, version bump and reproducible RC verification.
- No backend, telemetry, remote executable code, new required permission or default host permission.
"""
    ),
)

changelog = "CHANGELOG.md"
replace_once(
    changelog,
    "### Added\n\n",
    block(
        """\
### Added

- Durable stored capture settings and per-mode output preferences for visible, full-page, region, element and scroll-area jobs, including image quality, PDF page layout/quality and fixed/sticky handling.
- Separate options reset that restores preference defaults without deleting capture jobs, tiles, artifacts, locale or downloaded files.
- Validated `JOB_SUMMARY_CHANGED` runtime updates with revision filtering, exact listener cleanup and a 7.5-second authoritative reconciliation fallback instead of continuous 350 ms polling.
- Exactly-once recovery event synchronization across update, cancellation and interrupted worker recovery revisions.
- Simplified popup hierarchy with technical status in disclosure, no milestone/raw-tile copy in the default flow, primary capture actions before idle-only advanced settings, and keyboard/localization/atomic-feedback browser coverage.
- S25 clean validation with 344 unit tests across 99 files, four bounded PDF benchmarks, 51 Playwright E2E cases, reproducible 25-entry packaging and packaged lifecycle smoke.
"""
    ),
)
