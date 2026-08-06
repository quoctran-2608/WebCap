# Changelog

All notable changes to WebCap will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will use semantic versioning once distributable builds begin.

## [Unreleased]

## [0.2.0] - 2026-08-06

### Added

- S26 release hardening: package/manifest version 0.2.0, explicit 0.1.0 → 0.2.0 settings and locale migration validation, previous-stable Chrome compatibility, final gap disposition, release notes and AC-01–AC-40 traceability.
- Reproducible 0.2.0 release-candidate evidence: webcap-0.2.0.zip (25 entries, 1,195,785 bytes, SHA-256 a5e8a55d2e1038284199d702b27d57af8f351080b0c3d85c4019bc3a723a3e6d); read-only CI run 31072090616 and Release Candidate run 31072090612; Linux/Windows/macOS lifecycle and Chrome 116.0.5845.96, previous stable 150.0.7871.124 and current stable 151.0.7922.76 all pass.

- Durable stored capture settings and per-mode output preferences for visible, full-page, region, element and scroll-area jobs, including image quality, PDF page layout/quality and fixed/sticky handling.
- Separate options reset that restores preference defaults without deleting capture jobs, tiles, artifacts, locale or downloaded files.
- Validated `JOB_SUMMARY_CHANGED` runtime updates with revision filtering, exact listener cleanup and a 7.5-second authoritative reconciliation fallback instead of continuous 350 ms polling.
- Exactly-once recovery event synchronization across update, cancellation and interrupted worker recovery revisions.
- Simplified popup hierarchy with technical status in disclosure, no milestone/raw-tile copy in the default flow, primary capture actions before advanced settings, which are hidden while capture is busy, and keyboard/localization/atomic-feedback browser coverage.
- S25 clean validation with 344 unit tests across 99 files, four bounded PDF benchmarks, 51 Playwright E2E cases, reproducible 25-entry packaging and packaged lifecycle smoke.
- Mode-aware completion routing that automatically creates PDF for full-page and scroll-area captures, returns guarded PNG/JPEG/WebP for region and element captures, and preserves the existing visible-image flow.
- Durable output metadata and terminal-job restoration across popup reopen and Manifest V3 service-worker restart, with existing artifact reconciliation preventing duplicate output creation.
- Guarded sequential tiled-image composition with canvas dimension, total pixel-area and estimated working-set limits before allocation.
- Explicit `E_IMAGE_OUTPUT_TOO_LARGE` PDF fallback that reuses the same job and exact stored tile Blobs without selector reopen or pixel recapture.
- Editable auto-generated PDFs: an explicit edit reopens `completed` output safely, removes only the old PDF artifact and preserves source tiles for replacement export.
- S24 browser coverage for automatic PDF/image result cards, popup lifecycle recovery, editor re-export, and oversized-image fallback; the clean gate passes 325 unit tests across 92 files, four PDF benchmarks, 49 Playwright E2E cases and packaged lifecycle smoke.
- Versioned `CAPTURE_RESET` flow for visible sessions, persistent jobs and active-tab scope with request deduplication and idempotent missing-record behavior.
- Shared capture-owned cleanup covering source/output artifacts, tiles, PDF edit manifests, job records, session summaries and exact tab locks.
- User-facing “New capture” actions for preview and every terminal tiled state, plus confirmation before discarding an active capture.
- Reset-safe selector close commands and active capture/PDF/image-export quiescence so late callbacks cannot recreate deleted state.
- S21 unit and browser coverage for terminal reset, active reset, partial cleanup, replay safety, late image output, page restoration and immediate second capture on the same tab.
- Region-selector ready handshake that closes the popup only after root attachment, listeners, focus, and first render; launch timeout and injection failure reuse the reset primitive and leave no orphan job, root, summary, or tab lease.
- Accessible region creation and editing with pointer create/move/eight-handle resize, vertical and horizontal edge auto-scroll, 24 CSS-pixel handle targets, keyboard creation/movement/resizing/commit/cancel, and a toolbar kept above the selected rectangle.
- Selector removal plus two animation frames before capture, duplicate-open instance reuse, DPR/zoom coordinate coverage, and browser validation for overlay exclusion and exact page restoration.
- Adaptive full-page scroll capture with incremental row planning, stable-bottom detection, finite lazy-growth support and no arbitrary 100,000 CSS-pixel stopping cap.
- Durable resumable frontier that advances only after complete stored rows, resumes missing columns after interruption and preserves a rectangular contiguous prefix at time, tile, byte or storage guards.
- Source document, width, viewport and DPR revalidation plus service-worker restart recovery that does not recapture stored prefix rows.
- Idempotent page-preparation response re-enveloping so a restarted worker can reuse an existing prepared page without stale request-ID protocol failure.
- S23 browser fixtures for >100k pages, finite lazy growth, infinite-feed partial output and real service-worker target restart; the clean gate passes 306 unit tests across 88 files, four PDF benchmarks, 48 Playwright E2E cases and packaged lifecycle smoke.

## [0.1.0] - 2026-08-04

### Added

- Deterministic Chrome Web Store ZIP creation with fixed entry ordering, timestamps, Unix modes, CRC32 values, safe paths, root manifest placement, per-entry SHA-256 hashes, release manifest, checksum file, and byte-for-byte two-run reproducibility verification.
- Release metadata audit for synchronized version `0.1.0`, minimum Chrome 116, exact required and optional permissions, Vietnamese/English locales, icon dimensions, and forbidden package/store fields.
- Packaged clean-profile lifecycle validation for install, optional-host-permission absence, simulated update from 0.0.9 to 0.1.0 with stable extension ID and preserved `chrome.storage.local`, self-uninstall, and same-profile relaunch verification.
- Release Candidate workflow with read-only permissions, retained release evidence, Linux/Windows/macOS lifecycle coverage, and headed packaged compatibility checks on Chrome for Testing 116.0.5845.96 and 151.0.7922.71.
- Chrome Web Store handoff documents, bilingual listing copy, release checklist, known-limitations workarounds, release notes, and MUST acceptance-criteria traceability without creating a tag, GitHub Release, or store submission.
- The final S20 gate passes formatting, ESLint, strict TypeScript, privacy/license/release/critical-security audits, 279 unit tests across 79 files, four PDF benchmarks, a verified Manifest V3 build, and 38 Playwright E2E cases including DPR 1/1.5/2 at 80/100/125/150% zoom. The 24-entry `webcap-0.1.0.zip` is 1,097,035 bytes with SHA-256 `630c44c07e72da0d5edc1c82c013ecf6caf995e0542ee19679380081e7b0cb7a`.
- Persisted Vietnamese and English localization shared by the popup, PDF editor, region selector, element selector, restricted-page guidance, permission rationale, and every user-facing WebCap error code, with deterministic fallback that never exposes raw translation keys.
- Copyable versioned diagnostics JSON built from an explicit technical allowlist, plus normalized remote errors that retain safe codes/details while excluding URLs, page text, selectors, credentials, tokens, cookies, image data, and binary payloads.
- Production logger hardening with `warn` as the default threshold and a single safe-context boundary for finite counters and approved identifiers only.
- Contextual optional-permission explanations, local-first privacy documentation, restricted-Chrome-page guidance, keyboard/live-region/semantic-label/reduced-motion improvements, and browser coverage for locale persistence and diagnostics copying.
- Permanent `pnpm run audit` CI checks for remote executable code, analytics SDKs, unsafe diagnostic fields, default host permissions, direct dependency licenses, and lockfile inventory; all 18 direct packages are MIT or Apache-2.0 with zero incompatible direct licenses.
- The S19 clean read-only reference gate passes 276 unit tests across 78 files, four PDF benchmark scenarios, the verified Manifest V3 build, and 35 Playwright E2E cases, including trust UX and all S05–S18 regressions.
- Bounded lazy/infinite-page preparation with explicit completion reasons for stable height, maximum CSS height, elapsed duration, tile limit, and user-requested stop.
- Partial-capture metadata and popup warnings that preserve only a safe contiguous stored prefix, allow the user to keep captured tiles, and never represent guard-limited output as complete.
- Temporary scroll-snap suppression with compare-before-restore cleanup plus bounded layout-shift settling before measurement and capture.
- Deterministic iframe, Canvas 2D, WebGL, infinite-scroll, scroll-snap, and settling-layout fixtures, including compositor-pixel validation for same-origin and cross-origin frames without cross-origin DOM access.
- The S18 clean reference gate passes 268 unit tests across 75 files, four PDF benchmark scenarios, the verified Manifest V3 build, and 33 Playwright E2E cases including DPR 2 and 125% zoom.
- Typed PDF-source capability model for non-PDF, original passthrough, viewer capture, authentication-required, and unsupported sources using permitted URL, content-type, and Chrome PDF viewer signals.
- Explicit optional-origin and `file:///*` permission flow that runs only after user intent and leaves image capture available when permission is denied.
- Original PDF byte passthrough with active-tab revalidation, credential-context fetch, 128 MiB guard, `%PDF-` verification, SHA-256/size metadata, unchanged local IndexedDB Blob persistence, and download through the existing object-URL lifecycle without rasterization.
- Public `.pdf`, content-type-only PDF, and authentication-required fixtures; the S17 reference gate passes 265 unit tests across 74 files, four PDF benchmarks, the Manifest V3 build, and 26 Playwright E2E cases with zero artifact creation on auth failure.
- Full scrollable-area selection using computed overflow, client/scroll dimensions, sanitized candidate labels, and explicit visible-bounds versus full-scroll-content intent.
- Opaque content-runtime scroll-target snapshots with same-node revalidation, stale-target rejection, bounded settle checks, and exact restoration of container/document scroll and WebCap-owned inline mutations.
- Dedicated two-dimensional internal-scroll capture engine using rate-limited `captureVisibleTab`, container content-box crop metadata, overlap-aware logical output rectangles, and immediate local Blob persistence.
- Local sticky-descendant suppression scoped to the selected container, with compare-before-restore cleanup and no implicit scrolling of parent containers.
- Crop-aware PDF and thumbnail composition so full-viewport screenshots contribute only the selected scroll-area pixels.
- Nested vertical container, wide table, and removable modal/chat fixtures; the S16 reference gate passes 248 unit tests across 69 files, four PDF benchmarks, the Manifest V3 build, and 23 Playwright E2E cases.
- Pre-allocation PDF memory guard using total pixels, tile count, stored tile bytes, one-page RGBA, one decoded tile, encoded-page estimate, fixed overhead, and best-effort runtime heap limits.
- Retryable `E_MEMORY_GUARD` guidance for lower JPEG quality, A4/Letter multi-page output, or smaller page batches while preserving every source tile.
- PDF integrity validation before artifact persistence for signature, non-empty bytes, pdf-lib loadability, exact page count, page dimensions within 0.5 points, image backing, and non-empty streams.
- Export diagnostics for duration, artifact bytes, maximum decoded concurrency, maximum canvas area, working-set estimate, guard threshold, integrity counts, and best-effort heap peak.
- Dedicated `pnpm benchmark:pdf` reference suite covering 1,440 × 10k/30k/100k and 4,096 × 30k wide scenarios with machine-readable JSON metrics.
- The S15 clean reference gate passes 239 unit tests across 66 files, four PDF benchmark scenarios, the Manifest V3 build, and 20 Playwright E2E cases.
- Dedicated React PDF editor routed by persistent job ID, with reload-safe non-destructive edit manifests that never reorder or delete source tiles.
- Bounded lazy page thumbnails rendered from local tile Blobs, keyboard-accessible logical page reordering/removal, and cache identities tied to manifest revision.
- A4, Letter, fit-width, portrait/landscape, margin, and JPEG-quality controls with explicitly approximate size estimates.
- Edited-page PDF export through the page-at-a-time S13 pipeline, including per-page progress, cooperative cancellation, retry, local artifact download, and no recapture.
- Typed editor/offscreen protocols, IndexedDB read/write race hardening, progress ACK isolation, and browser validation covering reload persistence, thumbnail bounds, immutable source tiles, PDF integrity, and download.
- The S14 reference suite passes 230 unit tests across 64 files and 20 Playwright E2E cases.
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
