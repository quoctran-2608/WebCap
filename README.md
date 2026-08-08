# WebCap

WebCap is a local-first Chrome extension for capturing everything a web page presents: the visible viewport, a full page, a selected region, a DOM element, or a scrollable area. Long captures are processed in tiles and can be exported as images or multi-page PDF files without uploading page content to a server.

> The 0.1.0 MVP roadmap `S00–S20` is complete. WebCap 0.2.0 is planned in `S21–S26` around capture reset, reliable region drawing, adaptive auto-scroll, automatic PDF/mode-aware output, stored settings, event-driven progress and a simplified popup. Baseline scope remains in [`PRD_WebCap_v1.0.md`](./PRD_WebCap_v1.0.md); the 0.2.0 delta is in [`PRD_WebCap_v1.1.md`](./PRD_WebCap_v1.1.md). Technical contracts are defined by [`SPEC.md`](./SPEC.md) plus [`docs/spec-0.2.0.md`](./docs/spec-0.2.0.md), the 0.1.0 gap inventory is in [`docs/audits/0.1.0-gap-audit.md`](./docs/audits/0.1.0-gap-audit.md), and execution status is tracked in [`PLAN.md`](./PLAN.md).

## Current status

**0.1.0 release candidate remains complete and unchanged.** It has a deterministic, verified 24-entry Chrome Web Store ZIP (`webcap-0.1.0.zip`, 1,097,035 bytes, SHA-256 `630c44c07e72da0d5edc1c82c013ecf6caf995e0542ee19679380081e7b0cb7a`). The final gate passed formatting, ESLint, strict TypeScript, privacy/license/release/critical-security audits, 279 unit tests across 79 files, four PDF benchmarks, a verified Manifest V3 build, and 38 Playwright E2E cases including DPR 1/1.5/2 at 80/100/125/150% zoom. No tag, GitHub Release, Chrome Web Store upload, review submission, or publication has been performed.

**WebCap 0.2.0 release candidate is complete and ready for review.** S21–S25 delivered reset, reliable selectors, adaptive capture, automatic mode-aware output, stored settings and event-driven popup progress. S26 bumps the package to 0.2.0, validates upgrade from 0.1.0, adds previous-stable Chrome coverage, closes the gap audit and prepares a reproducible local-first release candidate without publishing it.

**PDF Engine V2 S27–S35 is complete and ready for release-owner review.** The engine now prefers byte-preserved original PDFs when safely available, discovers virtualized viewers incrementally, captures verified logical pages page-by-page, streams raster output to OPFS, resumes at durable page/writer checkpoints, handles storage pressure with page-aligned multipart fallback, hardens difficult viewers, and surfaces page-first verified UX plus bounded diagnostics. S35 clean read-only CI run `31258825875` passed 444/444 unit tests, 4/4 PDF benchmarks, 56/56 Playwright E2E and packaged lifecycle; the reproducible 25-entry `webcap-0.2.0.zip` is 1,341,084 bytes with SHA-256 `8bade485ee0672a2b160abf59f45c1772062ffc00724889c5aaa39294e7edb34`. No publication action has been performed.

## 0.2.0 and PDF Engine V2 outcomes

- Delivered in S23–S24: one-click **Full page → PDF** captures from document start, follows finite lazy growth, restores the page and automatically creates a PDF.
- Delivered in S22–S24: **Draw region** closes the popup only after selector readiness, supports pointer and keyboard editing, excludes selector UI and returns a guarded image result.
- Delivered in S21: **New capture** safely cancels or discards the current local job and allows another capture on the same tab.
- Delivered in S24: region/element default to guarded image output, full-page/scroll-area default to PDF, and oversized images receive an explicit no-recapture PDF fallback.
- Delivered in S25: durable per-mode output plus image/PDF/fixed-sticky preferences are loaded before capture, snapshotted into each new job and reset independently from capture data.
- Delivered in S25: validated runtime job-summary events replace continuous 350 ms polling; a 7.5-second authoritative reconciliation remains for missed events and reconnect.
- Delivered in S25: the primary capture action precedes advanced settings, which remain available at idle/result and disappear while capture is busy, while version, milestones, raw tile counts, privacy help and diagnostics no longer compete in the default main flow.
- Delivered in S26: 0.1.0 → 0.2.0 settings/locale migration coverage, minimum/previous/current Chrome compatibility, version 0.2.0 metadata, acceptance traceability and reproducible RC packaging.
- No backend, telemetry, remote executable code, new required permission or default host permission.
- Delivered in S27–S35: first-class PDF strategy negotiation, streamed original-source acquisition, virtualized viewer discovery, page-native bounded capture, OPFS streaming output, recovery/quota/multipart resilience, difficult-viewer hardening, page-first verified UX and content-free diagnostics.
- S35 keeps legacy/pre-manifest jobs backward compatible by falling back to durable job page/export progress without rewriting existing IndexedDB records.

## Requirements

- Node.js 22.12 or newer.
- Corepack enabled.
- pnpm version declared by the `packageManager` field in `package.json`.
- Chrome 116 or newer for loading the unpacked extension.

## Setup

```bash
corepack enable
corepack install
pnpm install --frozen-lockfile
```

## Commands

```bash
pnpm dev             # Run the popup entry with the Vite development server.
pnpm build           # Build and verify the Manifest V3 unpacked extension.
pnpm typecheck       # Run TypeScript without emitting files.
pnpm lint            # Run ESLint with zero warnings allowed.
pnpm format:check    # Verify formatting without modifying files.
pnpm format          # Format tracked source/configuration files.
pnpm audit           # Run privacy, dependency/license, and release-metadata audits.
pnpm audit:security  # Fail on known critical dependency advisories.
pnpm test:unit       # Run the unit-test suite once.
pnpm benchmark:pdf   # Run repeatable long-page PDF reference benchmarks.
pnpm test:e2e        # Run the persistent-Chromium extension regression suite.
pnpm test:smoke      # Smoke-test the built popup ↔ service-worker handshake in Chrome.
pnpm test:release    # Test packaged clean install, update, storage retention, and uninstall.
pnpm package         # Build, create, and verify the current release ZIP plus metadata.
pnpm package:verify  # Rebuild twice and require byte-for-byte ZIP reproducibility.
pnpm release:verify  # Run critical audit, reproducible package, and packaged lifecycle gates.
pnpm test            # Run Vitest in watch mode.
```

## Load the extension in Chrome

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the generated `dist/` directory.
6. Open the WebCap action popup and confirm that the service worker is connected.

The `dist/` output contains `manifest.json`, `popup.html`, `editor.html`, `service-worker.js`, `content-script.js`, `offscreen.html`, `offscreen.js`, hashed popup/editor assets, and the four extension icons. Generated output, dependency directories, test reports, and local browser profiles must not be committed.

## Source structure

```text
public/                 Manifest and static extension assets copied as-is.
assets/                 Internal build-time icon sources.
src/background/         Manifest V3 service worker, routing, coordination, reset and Chrome adapters.
src/capture/            Deterministic/adaptive planning and capture engines.
src/content/            Page preparation, selectors, lazy settle and restoration runtime.
src/editor/             React PDF editor, persistent manifest client and lazy thumbnail rendering.
src/popup/              React popup entry, goal UI, progress/result views and runtime clients.
src/shared/contracts/   Typed cross-context message envelopes.
src/storage/            IndexedDB and chrome.storage repositories.
tests/unit/             Deterministic contract, engine, coordinator, router and view-model tests.
tests/performance/      Repeatable PDF and long-page benchmark scenarios.
tests/e2e/              Playwright unpacked-extension integration tests.
tests/smoke/            Real-Chrome unpacked-extension smoke tests.
tests/release/          Packaged install/update/uninstall lifecycle validation.
scripts/release/        Deterministic ZIP implementation and verification primitives.
scripts/                Build, audit, packaging, browser-install and repository automation.
```

## Development rules

- Keep TypeScript strict; do not introduce `any` without an adapter-boundary justification.
- Add or update tests in the same change as behavior.
- Planning and documentation changes must pass `pnpm format:check` before merge.
- Do not add Chrome permissions, remote scripts, analytics or backend calls outside the approved PRD/SPEC scope.
- Complete only the active session in `PLAN.md`; defer unrelated work instead of expanding the current change.
- Preserve the 0.1.0 release artifact boundary until S26 deliberately creates a 0.2.0 package.
- Treat missing/duplicated content, orphan selector/job/lock, page-restore failure, privacy leaks and misleading complete/partial status as release blockers.
- Run the final merge gate through the repository's read-only CI workflow after every temporary write-enabled workflow and staging file has been removed.

## Documentation

- [0.1.0 product requirements](./PRD_WebCap_v1.0.md)
- [0.2.0 product requirements delta](./PRD_WebCap_v1.1.md)
- [Baseline engineering specification](./SPEC.md)
- [0.2.0 engineering specification addendum](./docs/spec-0.2.0.md)
- [0.1.0 gap audit and disposition](./docs/audits/0.1.0-gap-audit.md)
- [Active implementation plan](./PLAN.md)
- [Changelog](./CHANGELOG.md)
- [PDF benchmark and integrity reference](./docs/benchmarks.md)
- [Privacy baseline](./docs/privacy.md)
- [Known capture limitations](./docs/known-limitations.md)
- [0.1.0 release checklist](./docs/release-checklist.md)
- [0.1.0 release notes](./docs/release/0.1.0.md)
- [0.2.0 release-candidate notes](./docs/release/0.2.0.md)
- [0.1.0 acceptance-criteria evidence](./docs/release/acceptance-criteria-0.1.0.md)
- [0.2.0 acceptance-criteria evidence](./docs/release/acceptance-criteria-0.2.0.md)
- [Chrome Web Store assets handoff](./docs/store-assets.md)

<!-- S26_PACKAGE_EVIDENCE -->

The final read-only CI run 31072090616 and Release Candidate run 31072090612 verified webcap-0.2.0.zip (25 entries, 1,195,785 bytes, SHA-256 a5e8a55d2e1038284199d702b27d57af8f351080b0c3d85c4019bc3a723a3e6d), Linux/Windows/macOS lifecycle, and Chrome 116.0.5845.96, previous stable 150.0.7871.124 and current stable 151.0.7922.76. Final publication remains an explicit release-owner action.
