# Changelog

All notable changes to WebCap will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will use semantic versioning once distributable builds begin.

## [Unreleased]

### Added

- Page-size and unit-conversion primitives for A4, Letter, fit-width, portrait/landscape, margins, CSS pixels, millimeters, inches, and PDF points.
- Continuous PDF source slicing with running fractional pixel residuals so final page coverage reaches the exact source pixel without accumulated seams.
- Deterministic tile-to-page intersection planning that consumes overlap/output metadata and rejects missing or duplicated logical coverage.
- Page-at-a-time offscreen PDF rendering with one page-sized `OffscreenCanvas`, sequential single-tile decoding, per-page JPEG encoding, local `pdf-lib` embedding, and explicit bitmap/canvas release.
- Persistent `PDF_EXPORT_START` routing, monotonic page progress, output artifact IDs, `application/pdf` Blob storage, page-count metadata, retryable export failures, and source-tile preservation.
- PDF contract, state-machine, service, router, real-document integrity, memory-lifecycle, and browser integration coverage; the S13 reference suite passes 215 unit tests and 19 Playwright cases.
- Element capture mode with an isolated Shadow DOM hover/highlight selector, sanitized tag/id/class labels, dimensions, click confirmation, Enter/Escape controls, and parent/previous-child keyboard navigation.
- Recursive open-Shadow-DOM hit testing with `elementsFromPoint()`, `composedPath()` fallback, invalid-root/WebCap-root exclusion, and scrollable-candidate metadata.
- Opaque element target descriptors backed by content-runtime node identity, CSS document bounds through the shared CoordinateSpace, and revalidation after preparation plus immediately before each capture-engine attempt.
- Safe retryable `E_TARGET_STALE` handling that never substitutes a replacement node, preserves zero stored tiles on stale failure, restores the page, and exposes popup reselection.
- Element selection protocol, background service/router integration, persistent popup recovery, CDP-first/scroll-fallback target capture, and 200-unit/18-E2E validation including normal, open-shadow, stale, and keyboard-cancel fixtures.
- Region capture mode with a typed selection lifecycle that creates a persistent job before the popup closes and starts tiled capture only after the page confirms a target rectangle.
- A pure CoordinateSpace module for client, visual viewport, CSS document, and device-pixel conversions with bounds normalization, movement, eight-direction resizing, and edge auto-scroll calculations.
- An isolated Shadow DOM region overlay with drag, move, eight resize handles, dimensions, keyboard nudging, Enter confirmation, Escape cancellation, and two-frame removal before capture.
- Metadata-only active-job lookup so reopening the popup restores in-progress or ready full-page/region jobs without reading tile Blob payloads into session storage.
- Region target capture through the existing CDP-first and scroll-fallback engines, including target-start preparation, durable per-tile storage, progress, cancellation, and exact restoration.
- Region-selection fixtures and Playwright coverage for a target longer than the viewport, captured-pixel overlay exclusion, popup recovery, Escape cancellation, DPR 2, and 125% zoom.
- Automatic full-page routing from eligible CDP failures to a rate-limited active-tab scroll capture engine without creating a second job.
- Deterministic two-dimensional scroll tile planning with 64 CSS-pixel overlap, explicit logical output rectangles, edge crop metadata, and max-tile guardrails.
- Preserve, remove, and smart fixed/sticky policies with namespaced inline markers, compare-before-restore cleanup, and service-worker restart recovery.
- Scroll fallback guards for inactive tabs, scroll snapping, document-size drift, implausible screenshot scale, and per-axis pixel-scale changes between tiles.
- Fixed header/footer, sticky header, wide-table, and 10,000 CSS-pixel fixtures plus 10k/30k/100k deterministic planner benchmarks and Playwright fallback coverage.
- Primary CDP full-page capture engine using one short-lived stable-protocol debugger session and `Page.captureScreenshot` clips beyond the viewport.
- Immediate PNG tile persistence in IndexedDB with row-major ordering, stored-status metadata, bounded retry backoff, and progress only after durable storage.
- Persistent full-page job execution from prepare through measure, plan, capture, restore, processing, and ready, including cancellation checkpoints and primary-error preservation.
- Typed `JOB_PROGRESS` events plus popup full-page controls, tile progress, cancellation, retry, and future scroll-fallback guidance for eligible CDP failures.
- Deterministic 9,600 CSS-pixel full-page fixture and Playwright coverage for two-tile capture, Blob integrity, exact page restoration, debugger release, preparation cancellation, and occupied-debugger failure.
- Stable Chrome DevTools Protocol 1.3 attachment across the debugger client and extension integration tests.
- Versioned background-to-content page-preparation protocol with on-demand script injection and single active preparation ownership per tab.
- Self-contained classic `content-script.js` build verified without imports, remote URLs, new dependencies, permissions, or database migrations.
- Bounded lazy-load pre-scroll and layout settling using animation frames, mutation/resize observation, image decode best effort, duration limits, height limits, and cancellation checkpoints.
- Idempotent page restoration for scroll, focus, selection, injected freeze styles, and WebCap-owned inline mutations with compare-before-restore protection.
- Cleanup reporting with `E_LAYOUT_UNSTABLE`, `E_CANCELLED`, and `E_CLEANUP_PARTIAL` behavior that preserves the primary operation error.
- Playwright fixtures and coverage for lazy content, paused animation, layout shifts, fixed/sticky preservation, overlay cleanup, success, error, and cancellation paths.
- Typed Chrome debugger adapter and owned-session client with attach/command timeouts, unexpected-detach handling, and deterministic cleanup.
- CSS-first `Page.getLayoutMetrics` normalization with layout/visual viewports, device pixel ratio, zoom, and legacy-field fallback.
- Deterministic row-major 2D tile planner with target clamping, edge remainders, pixel-area and tile-count guardrails, and dynamic rectangle splitting.
- Coverage for short, wide, fractional, 10k, 30k, and 100k CSS-pixel pages plus debugger success, error, timeout, and detach paths.
- Persistent capture-job state machine with guarded transitions, invariants, and optimistic `stateRevision` compare-and-set writes.
- Versioned IndexedDB job, tile, artifact-cleanup, and request-dedupe repositories with normalized transaction failures.
- Metadata-only job summaries and per-tab leases in `chrome.storage.session`, including service-worker restart recovery.
- Idempotent `JOB_CREATE`, `JOB_GET`, and `JOB_CANCEL` contracts plus expiry cleanup that preserves actively leased jobs.
- Popup preview cards with local Blob URLs, image metadata, explicit download/retry/cancel controls, and accessible live status.
- Metadata-only visible session restoration through `chrome.storage.session` while binary artifacts remain in IndexedDB.
- Playwright persistent-Chromium extension coverage for preview pixels, popup reopen recovery, PNG download integrity, DPR 2, and 125% zoom.
- Permanent CI visible-capture E2E gate with retained Playwright reports.
- IndexedDB artifact storage with Blob-backed source/output records and expiry cleanup.
- Race-safe offscreen document processing for PNG, JPEG, and WebP image artifacts.
- Sanitized title/domain/timestamp filenames and Chrome download lifecycle with Blob URL revocation.
- Metadata-only export/download runtime contracts with retry and request deduplication that avoid recapture.
- Visible viewport capture through a typed Chrome tabs adapter and in-memory coordinator.
- Active-tab capability checks for supported web/file URLs and normalized restricted-page errors.
- Metadata-only capture protocol with request deduplication, single-job locking, rate limiting, and cancellation.
- Stable visible-capture fixture, focused unit/integration coverage, and manual Chrome validation guidance.
- Shared Zod domain and runtime message contracts with capability negotiation.
- Versioned local settings, migration, normalized errors, safe diagnostics, and permanent CI.
- TypeScript, Vite, React, Vitest, ESLint, and Prettier foundation.
- Strict compiler settings and source aliases for background, popup, and shared modules.
- Initial shared numeric range utility with unit tests.
- Reproducible pnpm bootstrap and quality-check commands.
- Manifest V3 definition with the approved WebCap permissions and optional host permissions.
- Multi-entry Vite build for a React popup and module service worker.
- Typed `PING`/`PONG` popup-to-worker handshake with runtime guards and tests.
- Internal WebCap icon set, build-output verification, and a real-Chrome smoke test.
