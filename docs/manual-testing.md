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

## S16 scrollable-area capture and restoration validation

1. Build and load the extension, serve `tests/fixtures/scroll-area.html`, open WebCap, choose **Vùng cuộn**, and start selection. Hover the nested vertical container and confirm the selector identifies it as scrollable without exposing page text or DOM markup.
2. Confirm the target and observe progress. The document scroll position and every ancestor scroll position must remain stable while only the selected container moves through its internal row-major tile plan.
3. Inspect stored tiles. Each tile must be a non-empty Blob with `captureViewportCss` and `captureCropCss`; the crop must match the selected container content box while logical output rectangles cover the complete `scrollWidth` × `scrollHeight` exactly once after overlap resolution.
4. Verify the nested fixture output includes the first and last logical rows, contains no repeated local sticky header, and restores the original `scrollTop`, `scrollLeft`, focus, document scroll, and WebCap-owned inline style values after completion.
5. Repeat with the wide table container. Confirm the engine creates a two-dimensional internal grid, reaches the far-right and bottom edges, and does not silently truncate when the tile guard would be exceeded.
6. Open the modal/chat-like fixture, begin full-scroll selection, remove the selected node before capture, and confirm retryable `E_TARGET_STALE`, zero stored tiles, no replacement-node capture, and complete cleanup.
7. Cancel during internal capture. Confirm the job settles as cancelled, stored partial tiles follow the existing job cleanup policy, and all container/document scroll and style snapshots are restored.
8. Export or thumbnail a captured scroll-area tile set. Confirm PDF/thumbnail composition uses only `captureCropCss`, not unrelated pixels from the full viewport screenshot.
9. Inspect runtime/storage boundaries: messages contain opaque target IDs and geometry metadata only; screenshots remain local IndexedDB Blob values; no new permission, remote service, analytics event, or schema migration is introduced.
10. Run `pnpm test:unit`, `pnpm benchmark:pdf`, and `pnpm test:e2e`. The S16 clean reference gate contains 248 unit tests across 69 files, four PDF benchmark cases, and 23 Playwright extension cases including nested scroll, wide table, stale modal/chat, open Shadow DOM, stale element, region, DPR/zoom, PDF, and full-page regressions.

## S17 PDF source detection and original-byte passthrough validation

1. Build and load the extension, serve the PDF fixture, navigate directly to the public `.pdf`, and open WebCap. Confirm the PDF source card reports original passthrough without fetching the body before explicit user action.
2. Choose the original-download action. If host access is not already granted, confirm Chrome requests only the exact HTTP(S) origin; for a local PDF, confirm the request is limited to `file:///*` and the UI explains that file-URL access must also be enabled for the extension.
3. Inspect the downloaded public PDF and the stored artifact metadata. Byte length and SHA-256 must match the fixture, the Blob must start with `%PDF-`, MIME type must be `application/pdf`, and no rasterized tile/page artifact may be created.
4. Repeat with a URL that has no `.pdf` suffix but returns `Content-Type: application/pdf`. Confirm detection uses the permitted HEAD/content-type signal and original passthrough still preserves the exact bytes.
5. Open an authentication-required fixture. Confirm the capability becomes `auth-required`, the UI gives an honest viewer/image-capture fallback, and no original artifact or download is created.
6. Deny the optional host/file permission. Confirm no PDF body request occurs, the error copy contains no cookie/token/credential value, and visible/full-page/region/element/scroll-area controls remain usable.
7. Change the active tab after capability detection and before download. Confirm background revalidation rejects the stale source rather than fetching or downloading a different tab URL.
8. Exercise an oversized or invalid-signature response. Confirm the 128 MiB guard or `%PDF-` validation fails safely, stores no artifact, and retains the existing capture flows.
9. Inspect runtime/storage boundaries: PDF requests and responses contain URL/capability/artifact metadata only; original bytes remain local Blob values in IndexedDB; no backend, analytics path, permanent `<all_urls>`, credential log, dependency, or PDF.js viewer is introduced.
10. Run `pnpm test:unit`, `pnpm benchmark:pdf`, and `pnpm test:e2e`. The S17 clean reference gate contains 265 unit tests across 74 files, four PDF benchmark cases, and 26 Playwright extension cases including public PDF, content-type-only PDF, authentication-required zero-artifact behavior, and all previous capture/export regressions.

## S18 capture hardening and partial-output validation

1. Build and load the extension, serve `tests/fixtures/infinite-scroll.html`, choose **Toàn bộ trang**, and start capture. Confirm preparation stops at the configured CSS-height guard, the ready job records `partialCapture.reason = "max-css-height"`, and the popup clearly states that the result is partial rather than complete.
2. Exercise a planner configuration whose full target would exceed `maxTiles`. Confirm the planner returns a deterministic row-major contiguous prefix, records `max-tiles`, and never leaves a logical gap inside the retained output rectangle.
3. During a multi-tile full-page capture, use **Dừng và giữ N tile** after at least one tile is stored. Confirm the job becomes ready with reason `user-stop`, retains only the complete contiguous prefix, and remains exportable. Repeat with **Hủy và xóa phần tạm** and confirm temporary tiles are removed and the job becomes cancelled.
4. Open `tests/fixtures/scroll-snap.html`, record the page scroll position and computed `scroll-snap-type`, then prepare the page. Confirm snapping is `none` while WebCap owns preparation. Restore without page interference and confirm the original snap style and scroll position return exactly. If page/user code changes an owned value after preparation, confirm compare-before-restore skips that value rather than overwriting the newer state.
5. Open `tests/fixtures/layout-shift-settles.html`. Confirm preparation waits through the bounded shifts and succeeds only after stable samples. The permanently unstable fixture must still return `E_LAYOUT_UNSTABLE` and complete cleanup.
6. Open `tests/fixtures/iframe-parent.html`. Capture the visible viewport and verify the browser-composited pixels of both the same-origin child and the child served from the alternate loopback origin. WebCap must not claim cross-origin DOM inspection or selection support.
7. Open `tests/fixtures/canvas-webgl.html`. Capture at the default project and at DPR 2 / Chrome zoom 125%. Verify the deterministic Canvas 2D and WebGL color regions are present in the output and the existing CSS-to-device-pixel boundary assertions remain green.
8. Inspect the ready/cancelled job and runtime messages. Partial reasons, limits, tile counts, and geometry may be stored as metadata, while screenshot bytes remain local IndexedDB Blobs. No page text, iframe DOM, Canvas pixels, or base64 image payload may appear in session/runtime metadata.
9. Review `docs/known-limitations.md` against the observed fixture behavior. Protected/DRM media, browser-internal restricted pages, cross-origin iframe DOM inspection, and compositor surfaces that Chrome itself omits must not be represented as supported.
10. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm benchmark:pdf`, `pnpm build`, and `pnpm test:e2e`. The S18 reference gate contains 268 unit tests across 75 files, four PDF benchmark cases, and 33 Playwright extension cases.

## S19 diagnostics, localization, privacy, permissions, and accessibility validation

1. Build and load the extension, open the popup on a supported fixture, and switch **Ngôn ngữ** between **Tiếng Việt** and **English**. Close and reopen the popup, then open the PDF editor and each selector. Confirm the selected language persists and no raw translation key is displayed.
2. Trigger representative permission, unsupported-page, capture, storage, memory, export, download, cancellation, and cleanup errors. Every user-facing failure must show a localized explanation and at least one safe next action; raw internal `message` text, stack traces, URLs, selectors, and credentials must not appear.
3. Use **Sao chép thông tin chẩn đoán** / **Copy diagnostic information** in the popup and editor. Parse the copied JSON and confirm it contains only schema/version, locale, surface, Chromium major bucket, worker/tab status, shortened job ID, mode/state/engine, bounded counts, formats/statuses, and error codes. It must not contain full URLs, page title/text/HTML, selector, filename/path, image/blob/base64 data, cookie, authorization header, or token.
4. Inspect production console output during normal capture/export. Debug and info records must be suppressed by default; warn/error records must contain only the logger allowlist. Feed a URL-, cookie-, bearer-, or token-like value through a test adapter and confirm the value is omitted or the event becomes `redacted`.
5. Navigate to a Chrome-restricted page such as `chrome://settings/`. Confirm capture controls are disabled and the popup explains the browser boundary without echoing the current URL. Return to a normal web page and confirm capture becomes available again.
6. Exercise original-PDF passthrough without prior host permission. Confirm the rationale appears before the request and states that access is scoped to the source and bytes stay local. Deny the optional permission and confirm all image-capture modes remain available.
7. Inspect the privacy/permission disclosure in the popup and compare it with `public/manifest.json`, `docs/privacy.md`, and `docs/permissions.md`. Required permissions and optional hosts must have matching purposes; no permanent default host permission, remote script, analytics SDK, or diagnostics-upload path may exist.
8. Run keyboard-only through popup and editor controls, region/element/scroll-area dialogs, page reorder/delete, export/cancel, locale, diagnostics, and disclosure controls. Confirm visible focus, logical tab order, Enter/Space activation, Escape cancellation, live status/error announcements, and no keyboard trap.
9. Enable reduced motion and high-contrast/forced-color preferences where available. Confirm progress and hover transitions do not carry essential meaning, controls remain visible, and primary text/control contrast remains readable.
10. Run `pnpm audit`, then inspect `docs/dependency-license-audit.md`. Every direct dependency must resolve to installed metadata and an approved license; the audit must fail on missing metadata or an incompatible direct license. Finish with the full format, lint, typecheck, unit, benchmark, production build, and Playwright suite.

The automated privacy test also observes extension/fixture traffic during the trust flow and rejects unexpected external HTTP(S) requests. This proves the selected capture/localization/diagnostics path is local-first; it is not a claim that Chrome itself never performs browser-maintenance traffic outside the tested context.

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

## S22 — Reliable region selector

1. Open a normal long page, choose **Vùng tự chọn**, and start selection. Confirm the popup closes only after the dim mask, crosshair, toolbar, and focused dialog are visible.
2. Trigger two duplicate open messages for the same job. Confirm there is one selector root and both ACKs return the same selector-instance ID.
3. Create a rectangle with the pointer; move it and resize all eight handles. Confirm every handle remains easy to hit and the toolbar stays clickable above the rectangle.
4. Hold the pointer near the bottom and right edges on a tall/wide page. Confirm vertical and horizontal auto-scroll extend the document rectangle; Escape restores both scroll axes and focus.
5. Create with Space or the toolbar. Verify arrows move, Shift+arrows move 10 px, Alt+arrows resize, Enter commits, and Escape cancels.
6. Repeat at DPR 2 and 125% zoom. Compare the displayed CSS document rectangle with the persisted target rectangle.
7. Force selector injection against a missing tab. Confirm the popup receives an error and IndexedDB/session storage contain zero orphan region jobs, summaries, tiles, selector roots, or tab leases.
8. Capture a region and inspect the first pixels. Confirm the dim mask, crosshair, toolbar, handles, and labels are absent from the output.

# S26 release-candidate matrix

- Verify clean packaged install and 0.1.0 → 0.2.0 update preserve extension ID, capture settings, English/Vietnamese locale and unrelated local storage.
- Verify minimum Chrome 116, previous stable and current stable packaged lifecycle.
- Verify Linux, Windows and macOS install/update/storage/uninstall lifecycle.
- Re-run static 30k/100k/>100k, finite lazy growth, infinite partial, region pointer/keyboard launch, element, scroll-area, visible, PDF passthrough, reset/restart and critical DPR/zoom flows.
- Confirm no tag, GitHub Release or Chrome Web Store publication occurs during validation.
