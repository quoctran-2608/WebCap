# WebCap

WebCap is a local-first Chrome extension for capturing everything a web page presents: the visible viewport, a full page, a selected region, a DOM element, or a scrollable area. Long captures are processed in tiles and can be exported as images or multi-page PDF files without uploading page content to a server.

> The 0.1.0 MVP implementation plan `S00–S20` is complete. WebCap 0.2.0 is now planned in `S21–S25` around adaptive auto-scroll, automatic PDF creation, capture reset/new-capture lifecycle, and a simplified popup. The baseline product scope remains in [`PRD_WebCap_v1.0.md`](./PRD_WebCap_v1.0.md); the 0.2.0 delta is in [`PRD_WebCap_v1.1.md`](./PRD_WebCap_v1.1.md). Technical contracts are defined by [`SPEC.md`](./SPEC.md) plus [`docs/spec-0.2.0.md`](./docs/spec-0.2.0.md), and execution status is tracked in [`PLAN.md`](./PLAN.md).

## Current status

**0.1.0 release candidate remains complete and unchanged.** It has a deterministic, verified 24-entry Chrome Web Store ZIP (`webcap-0.1.0.zip`, 1,097,035 bytes, SHA-256 `630c44c07e72da0d5edc1c82c013ecf6caf995e0542ee19679380081e7b0cb7a`). The final gate passed formatting, ESLint, strict TypeScript, privacy/license/release/critical-security audits, 279 unit tests across 79 files, four PDF benchmarks, a verified Manifest V3 build, and 38 Playwright E2E cases including DPR 1/1.5/2 at 80/100/125/150% zoom. No tag, GitHub Release, Chrome Web Store upload, review submission, or publication has been performed.

**0.2.0 is planned, not implemented.** The active roadmap begins with S21 capture reset, followed by adaptive auto-scroll to a stable page end, automatic PDF export, popup simplification, and a full 0.2.0 release gate. “Capture to the end” removes the arbitrary 100,000 CSS-pixel stopping behavior for adaptive mode, while retaining explicit time, storage, tile, and memory safeguards for truly infinite or device-exhausting pages.

## Planned 0.2.0 outcomes

- One-click **Full page → PDF**: scroll from document start, continue through finite lazy growth, restore the page, and automatically create a PDF.
- A clear **New capture** action that safely cancels or discards the current local job and allows another capture on the same tab.
- A simpler default popup focused on capture goals, progress, download, edit, and new capture; worker/version/tile/checksum details move to help and diagnostics.
- No backend, telemetry, remote executable code, new required permission, or default host permission.

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
src/background/         Manifest V3 service worker, job routing, capture coordination, and Chrome adapters.
src/capture/            Page measurement, deterministic/adaptive tile planning, and capture engines.
src/content/            On-demand page preparation, lazy settle, selection, and restoration runtime.
src/editor/             React PDF editor, persistent manifest client, and lazy thumbnail rendering.
src/popup/              React popup entry, capture controls, progress UI, and runtime clients.
src/shared/contracts/   Typed cross-context message envelopes.
src/storage/            IndexedDB and chrome.storage repositories.
tests/unit/             Fast deterministic contract, engine, coordinator, and router tests.
tests/performance/      Repeatable PDF and long-page benchmark scenarios and metric output.
tests/e2e/              Playwright unpacked-extension integration tests.
tests/smoke/            Real-Chrome unpacked-extension smoke tests.
tests/release/          Packaged install/update/uninstall lifecycle validation.
scripts/release/        Deterministic ZIP implementation and verification primitives.
scripts/                Build, audit, packaging, browser-install, and repository automation.
```

## Development rules

- Keep TypeScript strict; do not introduce `any` without an adapter-boundary justification.
- Add or update tests in the same change as behavior.
- Do not add Chrome permissions, remote scripts, analytics, or backend calls outside the approved PRD/SPEC scope.
- Complete only the active session in `PLAN.md`; defer unrelated work instead of expanding the current change.
- Preserve the 0.1.0 release artifact boundary until S25 deliberately creates a 0.2.0 package.
- Run the final merge gate through the repository's read-only CI workflow after every temporary write-enabled workflow and staging file has been removed.

## Documentation

- [0.1.0 product requirements](./PRD_WebCap_v1.0.md)
- [0.2.0 product requirements delta](./PRD_WebCap_v1.1.md)
- [Baseline engineering specification](./SPEC.md)
- [0.2.0 engineering specification addendum](./docs/spec-0.2.0.md)
- [Active implementation plan](./PLAN.md)
- [Changelog](./CHANGELOG.md)
- [PDF benchmark and integrity reference](./docs/benchmarks.md)
- [Privacy baseline](./docs/privacy.md)
- [Known capture limitations](./docs/known-limitations.md)
- [0.1.0 release checklist](./docs/release-checklist.md)
- [0.1.0 release notes](./docs/release/0.1.0.md)
- [0.1.0 acceptance-criteria evidence](./docs/release/acceptance-criteria-0.1.0.md)
- [Chrome Web Store assets handoff](./docs/store-assets.md)
