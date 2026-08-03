# Manual extension testing

## S05 visible preview and download

1. Run `pnpm build` and load `dist/` as an unpacked extension in Chrome.
2. Serve `tests/fixtures/visible-capture.html` over local HTTP and keep it as the active tab.
3. Open WebCap. Confirm the worker is connected and the tab status is **Có thể chụp**.
4. Select PNG and click **Tạo bản xem trước**.
5. Confirm the preview shows the four fixture quadrants, reports viewport dimensions multiplied by DPR, and does not include WebCap popup UI.
6. Close the popup after the preview appears, reopen WebCap, and confirm the same artifact preview is restored.
7. Click **Tải xuống**. Confirm the PNG opens, is non-empty, and the filename contains a sanitized page title, domain, and timestamp.
8. Repeat with JPEG and WebP. Changing the format after a preview should expose **Tạo lại định dạng** without recapturing the page.
9. Start a capture and click **Hủy chụp**. Cancellation must be announced without being presented as an unknown failure.
10. Close the popup while capture is in progress. Reopen it and confirm the session either resumes processing or restores the final preview.
11. Inspect extension IndexedDB `webcap-db`: source/output bytes remain `Blob` values in `artifacts`; `chrome.storage.session` contains metadata only under `webcap.visible-session`.
12. On a 125% zoom tab and DPR 2 display, repeat the capture and compare the reported pixel dimensions with `innerWidth × devicePixelRatio` and `innerHeight × devicePixelRatio`.
13. Open an unsupported URL such as `chrome://settings`; capture controls must remain disabled.
14. Use keyboard-only navigation and verify visible focus on format, capture, retry, cancel, and download controls.

## Automated S05 smoke

Run:

```bash
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

The Playwright harness copies `dist/` to a temporary test directory and grants only the local fixture host permission. The production manifest is not modified. The smoke suite launches the bundled Chromium channel with an unpacked extension, opens the real action popup, validates preview pixels and dimensions, reopens the popup to verify restoration, downloads a PNG, and runs a DPR 2 / 125% zoom dimension check.

## S06 persistent job storage inspection

S06 is an infrastructure milestone and does not expose full-page controls yet. After loading `dist/`, inspect the extension service worker in Chrome DevTools while exercising a typed `JOB_CREATE`, `JOB_GET`, or `JOB_CANCEL` message from an extension context:

1. Confirm IndexedDB `webcap-db` stores the complete record in `jobs` and any future binary tile payload only in `tiles`.
2. Confirm `chrome.storage.session["webcap.jobs.session"]` contains summaries and tab leases only; it must not contain settings, tile plans, page content, or Blob/base64 image data.
3. Re-send the same command with the same `requestId`; the response must be identical and no duplicate job may be created.
4. Reload the unpacked extension while a simulated job is in `preparing`, `capturing`, `processing`, or `exporting`; initialization must settle cleanup and restore it as retryable `failed` rather than silently resuming unsafe browser work.
5. Verify an unexpired per-tab lease blocks a second non-terminal job, while an expired lease can be replaced.
6. Verify expiry cleanup removes job, tile, artifact, summary, and lock records but skips a job whose lease is still valid.

The deterministic S06 behavior is covered by `pnpm test:unit`; existing `pnpm test:e2e` remains the regression gate for the completed visible-capture slice.

## S07 debugger metrics and tile planning inspection

S07 remains an infrastructure milestone and does not expose a full-page capture button yet. Use the unit suite as the deterministic gate, and inspect a development invocation of `CdpMeasurementService` only on a disposable web tab:

1. Confirm WebCap attaches with stable protocol version `1.3`, enables the Page domain, reads `Page.getLayoutMetrics`, evaluates `window.devicePixelRatio`, and detaches immediately after measurement/planning.
2. Open Chrome DevTools or another debugger before measurement; WebCap must return a normalized retryable `E_DEBUGGER_ATTACH` instead of stealing or hiding the existing debugger session.
3. Close or cancel the debugger while the task is active; WebCap must surface `E_DEBUGGER_DETACHED` and release its per-tab ownership.
4. Inspect normalized metrics: CSS content size is preferred, layout/visual viewport scroll offsets are retained, DPR and zoom are finite positive values, and no page URL/content is logged.
5. Plan short, wide, fractional, 10k, 30k, and 100k CSS-pixel rectangles. Tile IDs and indexes must be stable row-major values; final rows/columns cover only the remainder with no gap, overlap, negative, or zero dimension.
6. Raise pixel scale or lower the pixel-area guardrail and confirm tile height shrinks or dynamic splitting produces safe sub-rectangles; exceeding `maxTiles` must fail with `E_TILE_PLAN`.

Run `pnpm test:unit` for debugger/metrics/planner behavior and `pnpm test:e2e` to preserve the completed visible-capture regression slice.

## S08 page preparation and restoration inspection

S08 was an infrastructure milestone before full-page controls were enabled. Exercise `PagePreparationService` or the versioned content protocol only on disposable fixture tabs:

1. Run `pnpm build` and confirm `dist/content-script.js` exists, contains no module imports or remote URLs, and is injected only through `chrome.scripting.executeScript()` when preparation starts.
2. On `tests/fixtures/animated-page.html`, prepare the page and confirm animations are paused, the caret is transparent, and smooth scrolling is disabled while the preparation is active.
3. On `tests/fixtures/lazy-images.html`, enable lazy loading and confirm WebCap scrolls in bounded steps, waits for stable layout samples, loads the deferred sections, returns to the target start, and reports the measured document dimensions.
4. On `tests/fixtures/fixed-sticky.html`, confirm S08 does not mutate the fixed or sticky elements; only a known WebCap overlay is hidden and its original inline `style` attribute is restored byte-for-byte.
5. Restore after success and compare window scroll, active element, selection, injected style count, document/body inline styles, and WebCap-owned modified nodes with the pre-prepare snapshot.
6. Force `E_LAYOUT_UNSTABLE` with `tests/fixtures/layout-shift.html`; cleanup must still restore the page before the error response is returned.
7. Cancel during lazy pre-scroll; the prepare request must return `E_CANCELLED`, cleanup must complete, and a second restore request must be idempotent.
8. Change a WebCap-modified inline style from page code after prepare; restore must skip that node rather than overwrite the site's newer value and must report the skipped mutation.
9. Verify a partial cleanup report is normalized as `E_CLEANUP_PARTIAL` without masking an earlier capture/operation error.
10. Re-run the completed visible-capture flow to confirm S08 does not change existing popup behavior, manifest permissions, IndexedDB schema, or image export.

Automated coverage is included in `pnpm test:unit` and `pnpm test:e2e`. The Playwright suite covers lazy content, animation freeze, fixed/sticky preservation, exact inline-style restoration, unstable layout cleanup, cancellation, and the two existing visible-capture regressions.

## S09 CDP tiled full-page capture inspection

1. Build and load the extension, serve `tests/fixtures/full-page-long.html`, open WebCap, choose **Toàn bộ trang**, and start capture.
2. Confirm the popup moves through preparation and tile progress, then reports a ready tile set rather than offering a final composed image; composition remains outside S09.
3. Inspect IndexedDB `webcap-db`: the full-page job should be `ready`, `completedTiles` should equal `totalTiles`, every planned tile should be `stored`, and each `tiles` record should contain a non-empty PNG `Blob` whose size matches the tile metadata.
4. Confirm the 9,600 CSS-pixel fixture produces two row-major tiles with indexes `0` and `1`; no base64 payload may remain in persistent job/session metadata.
5. Compare scroll position, focused element, document/body inline styles, and preparation-style count before and after capture; they must match exactly.
6. Inspect `chrome.debugger.getTargets()` or reattach with protocol `1.3` after the job reaches `ready`; WebCap must no longer own the debugger session.
7. Start capture on `tests/fixtures/lazy-images.html` and cancel while preparation is active; cancellation should reach the content runtime promptly, restore the page, and settle the job as `cancelled` with `E_CANCELLED`.
8. Attach another debugger to a disposable tab before starting WebCap. The job must fail with retryable, fallback-eligible `E_DEBUGGER_ATTACH`, the popup must explain that scroll fallback will become available in S10, and the page must still be restored.
9. Exercise a synthetic transient `Page.captureScreenshot` failure in unit tests and confirm one initial attempt plus at most two retries with bounded delays; permanent errors must stop retrying.
10. Verify progress increments only after each tile Blob is stored and that cancellation between tiles does not capture or persist the next tile.

Run `pnpm test:unit` and `pnpm test:e2e`. S09 automated coverage includes CDP clips, retry bounds, immediate Blob storage, progress, success, preparation cancellation, occupied-debugger failure, page restoration, debugger release, all S08 preparation tests, and both visible-capture regressions.

## S10 scroll fallback, fixed policy, and long-page validation

1. Build and load the extension, open a disposable HTTP page, choose **Toàn bộ trang**, and keep the source tab active while fallback is running.
2. Attach Chrome DevTools or another debugger to the source tab before starting capture. WebCap must fail CDP attachment, reuse the same persistent job, delete any partial CDP tiles, switch `activeEngine` to `scroll`, and finish with a new complete tile plan.
3. Inspect IndexedDB `tiles`: every scroll tile must contain a non-empty PNG Blob, row/column/index metadata, the raw viewport `sourceRectCss`, a logical `outputRectCss`, and overlap/crop fields. Logical output rectangles must cover the target without a gap.
4. On `tests/fixtures/fixed-header-footer.html` with the default smart policy, confirm the bottom fixed element is hidden on the first tile, both repeated edge elements are hidden on middle tiles, and the top fixed element is hidden on the final tile. No `data-webcap-scroll-*` marker or inline-style mutation may remain afterward.
5. Repeat on `tests/fixtures/sticky-header.html` and verify sticky candidates are treated by the selected preserve/remove/smart policy without duplicating the header outside that policy.
6. On `tests/fixtures/wide-table.html`, confirm fallback creates multiple rows and columns, horizontal and vertical overlap metadata are present, and the page returns to its original scroll/focus/style state.
7. On `tests/fixtures/long-page-10k.html`, confirm the active-tab fallback captures at least 19 tiles, completes within the E2E timeout, and restores the original scroll position. The CI reference run completed this case in about 25.4 seconds.
8. Change tabs during fallback and confirm the job fails with `E_TAB_NOT_ACTIVE` before another screenshot is stored. Add scroll snapping or change document dimensions during capture and confirm `E_LAYOUT_UNSTABLE` cleanup.
9. Verify screenshot scale is calibrated from the first visible tile independently on the X and Y axes, while later tiles must retain both scales within two pixels; this accommodates scrollbar geometry without accepting zoom/DPR drift.
10. Run `pnpm test:unit` for deterministic 10k/30k/100k planning and `pnpm test:e2e` for CDP success, automatic fallback, smart fixed policy, 2D wide-table coverage, 10k capture, page restoration, cancellation, and visible-capture regressions.

Reference validation on Chrome for Testing 151: smart fixed fixture about 9.2 seconds, wide-table 2D fixture about 11.2 seconds, and 10k fallback fixture about 25.4 seconds. The 30k and 100k cases remain deterministic planner/guardrail benchmarks because a full rate-limited browser capture would intentionally lengthen CI; their planned tile counts are 56 and 187 respectively.
