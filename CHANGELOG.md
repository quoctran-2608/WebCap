# Changelog

All notable changes to WebCap will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will use semantic versioning once distributable builds begin.

## [Unreleased]

### Added

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
