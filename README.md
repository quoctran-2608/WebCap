# WebCap

WebCap is a local-first Chrome extension for capturing everything a web page presents: the visible viewport, a full page, a selected region, a DOM element, or a scrollable area. Long captures are processed in tiles and can be exported as images or multi-page PDF files without uploading page content to a server.

> The 0.1.0 MVP roadmap `S00–S20` is complete. WebCap 0.2.0 is planned in `S21–S26` around capture reset, reliable region drawing, adaptive auto-scroll, automatic PDF/mode-aware output, stored settings, event-driven progress and a simplified popup. Baseline scope remains in [`PRD_WebCap_v1.0.md`](./PRD_WebCap_v1.0.md); the 0.2.0 delta is in [`PRD_WebCap_v1.1.md`](./PRD_WebCap_v1.1.md). Technical contracts are defined by [`SPEC.md`](./SPEC.md) plus [`docs/spec-0.2.0.md`](./docs/spec-0.2.0.md), the 0.1.0 gap inventory is in [`docs/audits/0.1.0-gap-audit.md`](./docs/audits/0.1.0-gap-audit.md), and execution status is tracked in [`PLAN.md`](./PLAN.md).

## Current status

**0.1.0 release candidate remains complete and unchanged.** It has a deterministic, verified 24-entry Chrome Web Store ZIP (`webcap-0.1.0.zip`, 1,097,035 bytes, SHA-256 `630c44c07e72da0d5edc1c82c013ecf6caf995e0542ee19679380081e7b0cb7a`). The final gate passed formatting, ESLint, strict TypeScript, privacy/license/release/critical-security audits, 279 unit tests across 79 files, four PDF benchmarks, a verified Manifest V3 build, and 38 Playwright E2E cases including DPR 1/1.5/2 at 80/100/125/150% zoom. No tag, GitHub Release, Chrome Web Store upload, review submission, or publication has been performed.

**0.2.0 implementation is active. S21 capture reset, S22 region-selector reliability, S23 adaptive auto-scroll and S24 automatic mode-aware output are complete; S25 settings/events/simplified popup is next.** Full-page and scroll-area captures now create PDF automatically, while region and element captures create guarded PNG/JPEG/WebP output. Durable result metadata survives popup reopen and service-worker restart, auto-generated PDFs remain editable without recapture, and oversized image output offers an explicit PDF fallback that reuses the same stored tiles. S25–S26 remain planned for stored settings, event-driven progress, popup simplification and release hardening.

## 0.2.0 outcomes and remaining work

- Delivered in S23–S24: one-click **Full page → PDF** captures from document start, follows finite lazy growth, restores the page and automatically creates a PDF.
- Delivered in S22–S24: **Draw region** closes the popup only after selector readiness, supports pointer and keyboard editing, excludes selector UI and returns a guarded image result.
- Delivered in S21: **New capture** safely cancels or discards the current local job and allows another capture on the same tab.
- Delivered in S24: region/element default to guarded image output, full-page/scroll-area default to PDF, and oversized images receive an explicit no-recapture PDF fallback.
- Remaining in S25: apply stored format, quality, PDF and fixed/sticky preferences to every new job.
- Remaining in S25: replace continuous 350 ms polling with event-driven progress and slow reconciliation.
- Remaining in S25: simplify the popup around capture goals, progress, download, edit and new capture; move technical details to help and diagnostics.
- No backend, telemetry, remote executable code, new required permission or default host permission.

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
- [0.1.0 acceptance-criteria evidence](./docs/release/acceptance-criteria-0.1.0.md)
- [Chrome Web Store assets handoff](./docs/store-assets.md)
