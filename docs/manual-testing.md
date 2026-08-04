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

## S11 CoordinateSpace and region selector inspection

1. Build and load the extension, serve `tests/fixtures/region-selection.html`, open WebCap, select **Vùng tự chọn**, and click **Bắt đầu chọn vùng**.
2. Confirm a single `data-webcap-region-selector` root is injected. Its controls and styles must live inside an isolated Shadow DOM; the page must not receive global selector classes or styles.
3. Drag from an empty page point to create a selection, drag the selection body to move it, and use all eight handles to resize it. The displayed dimensions must track the CSS document rectangle.
4. Use arrow keys to nudge by one CSS pixel and Shift+arrow to nudge by ten. Press Enter to confirm or Escape to cancel; keyboard focus must remain visible on actionable controls.
5. Drag near the bottom or side of the viewport. The page should auto-scroll while the stored target continues growing in document coordinates and can extend beyond the initial viewport.
6. Confirming must remove the overlay before page preparation/capture begins and wait at least two animation frames. The captured PNG tile must contain page pixels at the selection origin, not the yellow selector border or dimming mask.
7. Inspect the region job in IndexedDB: `mode` is `region`, `targetRect` is the confirmed CSS document rectangle, the job progresses through the existing tiled coordinator, and every stored tile is a non-empty Blob. Session storage remains metadata-only.
8. Close or reopen the popup after selection/capture. With the source tab active, WebCap should recover the latest active/ready region job through `JOB_GET_ACTIVE` and show its correct progress or ready state.
9. Press Escape before confirming. The selector root must disappear, no tiles should be stored, the job must settle as `cancelled` with `E_CANCELLED`, cleanup must be complete, and scroll/focus/document/body styles must match the pre-selection snapshot.
10. Repeat at DPR 2 and Chrome zoom 125%. The confirmed `targetRect` must remain stable in CSS document coordinates while the capture engine handles screenshot pixel scale separately.

Run `pnpm test:unit` for the coordinate matrix, protocol, selector service, router, active-job lookup, and cancellation semantics. Run `pnpm test:e2e` for region auto-scroll capture, overlay pixel exclusion, popup recovery, Escape cancellation, zoom/DPR, and all existing visible/full-page regressions. Reference CI run `30799895160` passed 188 unit tests across 49 files and 14 Playwright tests on Chrome for Testing 151.

## S12 element selector and stale-target validation

1. Build and load the extension, serve `tests/fixtures/element-selection.html`, open WebCap, choose **Phần tử**, and start selection.
2. Move the pointer over nested elements. Confirm the cyan highlight follows the deepest valid candidate and the label contains only sanitized tag, optional id, up to three classes, and visible dimensions; page text must not be copied into persistent metadata.
3. Click the violet child panel, press **ArrowUp** to select its article parent, then **ArrowDown** to return to the previously selected child. Press **Enter** and confirm the stored CSS document rectangle matches the child bounds and the resulting PNG tile contains the violet target rather than the selector UI.
4. Repeat on the open shadow-root button. Confirm WebCap selects `button#shadow-action.shadow-button` rather than only the custom-element host, even after the fixture was scrolled before selection.
5. Select the stale fixture target, remove it from the page before pressing Enter, and confirm the job fails with retryable `E_TARGET_STALE`, stores no tiles, restores scroll/focus/styles, and offers **Chọn lại phần tử**. Replacing it with another node at the same position must not be accepted as the original identity.
6. Start selection with the focus fixture button active, confirm the selector dialog and Hủy button are keyboard reachable, press **Escape**, and verify the job is cancelled with `E_CANCELLED` while the original focus, scroll, and inline styles are restored.
7. Inspect IndexedDB: the job may contain the sanitized opaque target descriptor and CSS rectangle, but not a DOM node, page text, HTML, screenshot bytes, or selector state. Binary tiles remain Blob values in the tile store.
8. Verify normal element capture revalidates the same content-runtime identity after page preparation and again before the engine attempt; moving the same connected node may update its bounds, but disconnecting/replacing it must stop capture.
9. A scrollable candidate is labelled as scrollable but S12 captures visible bounds only. Full internal scroll content remains disabled until S16. Closed shadow-root deep inspection is unsupported and must not be represented as available.
10. Run `pnpm test:unit` and `pnpm test:e2e`. The reference S12 suite contains 200 unit tests across 53 files and 18 Playwright cases, including all prior visible, full-page, fallback, preparation, and region regressions.

## S13 page-at-a-time PDF export validation

1. Build and load the extension, serve `tests/fixtures/full-page-long.html`, and create a ready full-page tile set. S13 intentionally does not expose a PDF button in the popup; the user-facing editor and options arrive in S14.
2. From an extension context, send a typed `PDF_EXPORT_START` request for the ready job with A4 portrait, 8 mm margins, and a JPEG quality such as 0.82. The immediate response must contain the same job in `exporting` with page progress initialized at zero.
3. Inspect the job while export runs. `completedPages` must increase monotonically and never exceed `totalPages`; reopening or polling the job must not transfer tile/image Blob bytes through runtime messages.
4. When complete, confirm the job contains `outputArtifactId`, equal completed/total page counts, and state `completed`. The original source tile records must still exist for later S14 retry/re-export.
5. Inspect the output artifact in IndexedDB: format `pdf`, MIME `application/pdf`, a non-empty Blob, a positive page count, and a filename ending in `.pdf`. The first five bytes should decode to `%PDF-`.
6. Open the generated file in Chrome and another PDF reader. Confirm all pages load and the source proceeds continuously from top to bottom without a white gap or duplicated strip at page/tile boundaries.
7. Repeat pure layout checks for A4, Letter, landscape, fit-width, fractional source heights, and DPR-derived non-integer pixel ranges. The final range must end exactly at the rounded source pixel height.
8. Remove a stored source tile before export. WebCap must fail before page-canvas allocation with retryable `E_STORAGE_READ`; no partial output artifact may be persisted.
9. Force JPEG/PDF encoding failure after export starts. The job must become retryable `failed` with `E_EXPORT_FAILED`, while the stored capture tiles remain intact.
10. Run `pnpm test:unit` and `pnpm test:e2e`. The S13 reference suite contains 215 unit tests across 58 files and 19 Playwright cases, including a real 9,600 CSS-pixel tile-set-to-PDF browser export and all previous capture regressions.

## S14 PDF editor and non-destructive retry validation

1. Build and load the extension, capture `tests/fixtures/full-page-long.html`, and wait until the full-page tile set is ready.
2. Click **Mở trình biên tập PDF**. Confirm the dedicated editor URL contains the job ID and shows more than two logical pages.
3. Wait for the first thumbnail. Its longest edge must be at most 320 pixels; thumbnails and PDF bytes remain Blob values in IndexedDB and never cross runtime messages.
4. Change paper size to Letter, orientation to landscape, margin to 12 mm, and JPEG quality to 0.75. Apply settings and confirm the page list and approximate estimate are recalculated.
5. Focus the first page card and press Alt+ArrowDown. Confirm the logical source order changes, then remove the last page. Source tile count and total source Blob bytes must remain unchanged.
6. Reload the editor. Confirm page count, order, settings, and manifest revision are restored from `chrome.storage.local`.
7. Create the PDF and observe monotonic per-page progress. Cancel during export and retry; the retry must reuse the same source tiles without invoking capture again.
8. Download the completed artifact. Confirm the file begins with `%PDF-`, page count matches the edited manifest, page dimensions match the selected settings, and every page has a non-empty image stream.
9. Inspect IndexedDB and session/local storage: binary source tiles, thumbnails, and PDF artifacts are local Blobs; persistent messages and edit manifests contain metadata only.
10. Run `pnpm test:unit` and `pnpm test:e2e`. The S14 reference gate contains 230 unit tests and 20 Playwright cases, including the full reload–edit–export–download path plus all prior capture regressions.

## S15 PDF benchmark, integrity, and memory-guard validation

1. Run `pnpm install --frozen-lockfile`, then `pnpm benchmark:pdf`. Confirm four machine-readable `webcap-pdf-benchmark` JSON lines are printed for 1,440 × 10k, 30k, 100k and 4,096 × 30k wide scenarios.
2. Confirm every scenario creates a non-empty PDF, planned page count matches the persisted artifact, `maxDecodedTiles` is one, and the largest page canvas remains smaller than the logical full-page pixel area.
3. Inspect the 100k reference: it should plan 13 stored tiles and 48 PDF pages while keeping the deterministic working-set estimate below the active guard threshold. Treat elapsed times as CI reference measurements, not real browser raster/JPEG latency.
4. Export a normal ready job through the extension. Before the first canvas allocation, verify the guard accounts for total pixels, tile count, stored source bytes, page RGBA, largest decoded tile, estimated JPEG bytes, fixed overhead, and best-effort heap limit.
5. Force an unsafe fit-width/wide-page estimate. Confirm export stops before creating a PDF document or canvas with retryable `E_MEMORY_GUARD` and offers lower quality, A4/Letter multi-page output, or removing/exporting smaller page batches.
6. Confirm the guard failure stores no output artifact and leaves the source tile count and Blob bytes unchanged so retry does not recapture.
7. Corrupt the generated PDF signature or produce a blank/image-less document in a test adapter. Confirm the integrity check returns retryable `E_EXPORT_FAILED` with cause `PdfIntegrityCheckFailed`, persists no corrupt artifact, and preserves source tiles.
8. For a valid PDF, verify `%PDF-`, non-zero bytes, pdf-lib loadability, exact page count, dimensions within 0.5 PDF points, at least one image object, and non-empty streams before artifact persistence.
9. Inspect diagnostics: duration, artifact bytes, decoded count/concurrency, maximum page-canvas area, released canvas count, working-set estimate, threshold, integrity counts, and heap peak when the runtime exposes it. No diagnostic may contain page content or image bytes.
10. Run `pnpm test:unit`, `pnpm benchmark:pdf`, and `pnpm test:e2e`. The S15 clean reference gate contains 239 unit tests across 66 files, four benchmark cases, and 20 Playwright cases.
