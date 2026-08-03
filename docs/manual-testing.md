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

1. Confirm WebCap attaches with protocol version `0.1`, enables the Page domain, reads `Page.getLayoutMetrics`, evaluates `window.devicePixelRatio`, and detaches immediately after measurement/planning.
2. Open Chrome DevTools or another debugger before measurement; WebCap must return a normalized retryable `E_DEBUGGER_ATTACH` instead of stealing or hiding the existing debugger session.
3. Close or cancel the debugger while the task is active; WebCap must surface `E_DEBUGGER_DETACHED` and release its per-tab ownership.
4. Inspect normalized metrics: CSS content size is preferred, layout/visual viewport scroll offsets are retained, DPR and zoom are finite positive values, and no page URL/content is logged.
5. Plan short, wide, fractional, 10k, 30k, and 100k CSS-pixel rectangles. Tile IDs and indexes must be stable row-major values; final rows/columns cover only the remainder with no gap, overlap, negative, or zero dimension.
6. Raise pixel scale or lower the pixel-area guardrail and confirm tile height shrinks or dynamic splitting produces safe sub-rectangles; exceeding `maxTiles` must fail with `E_TILE_PLAN`.

Run `pnpm test:unit` for debugger/metrics/planner behavior and `pnpm test:e2e` to preserve the completed visible-capture regression slice.
