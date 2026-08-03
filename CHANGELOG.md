# Changelog

All notable changes to WebCap will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will use semantic versioning once distributable builds begin.

## [Unreleased]

### Added

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
