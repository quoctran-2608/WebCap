# WebCap

WebCap is a local-first Chrome extension for capturing everything a web page presents: the visible viewport, a full page, a selected region, a DOM element, or a scrollable area. Long captures are processed in tiles and can be exported as images or multi-page PDF files without uploading page content to a server.

> The MVP implementation plan `S00–S20` is complete. Product scope is defined in [`PRD_WebCap_v1.0.md`](./PRD_WebCap_v1.0.md), technical contracts in [`SPEC.md`](./SPEC.md), and the completed session record in [`PLAN.md`](./PLAN.md). Chrome Web Store publication remains a separate release-owner action.

## Current status

**S20 — release candidate, packaging, and store readiness is complete.** WebCap 0.1.0 now has a deterministic, verified 24-entry Chrome Web Store ZIP (`webcap-0.1.0.zip`, 1,097,035 bytes, SHA-256 `630c44c07e72da0d5edc1c82c013ecf6caf995e0542ee19679380081e7b0cb7a`), synchronized manifest/package versions, release metadata and permission audits, release notes, known limitations, privacy/store copy, and acceptance-criteria traceability. The final release gate passes formatting, ESLint, strict TypeScript, privacy/license/release/critical-security audits, 279 unit tests across 79 files, four PDF benchmarks, a verified Manifest V3 build, and 38 Playwright E2E cases including DPR 1/1.5/2 at 80/100/125/150% zoom. The packaged extension installs, updates from 0.0.9 to 0.1.0 while retaining its ID and local storage, and uninstalls cleanly on Linux, Windows, and macOS; the same lifecycle passes Chrome for Testing 116.0.5845.96 and 151.0.7922.71. No tag, GitHub Release, Chrome Web Store upload, review submission, or publication has been performed.

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
pnpm package         # Build, create, and verify webcap-0.1.0.zip plus release metadata.
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
6. Open the WebCap action popup and confirm that **Service worker** shows **Đã kết nối**.

The `dist/` output contains `manifest.json`, `popup.html`, `editor.html`, `service-worker.js`, `content-script.js`, `offscreen.html`, `offscreen.js`, hashed popup/editor assets, and the four extension icons. Generated output, dependency directories, test reports, and local browser profiles must not be committed.

## Source structure

```text
public/                 Manifest and static extension assets copied as-is.
assets/                 Internal build-time icon sources.
src/background/         Manifest V3 service worker, job routing, capture coordination, and Chrome adapters.
src/capture/            Page measurement, deterministic tile planning, and capture engines.
src/content/            On-demand page preparation, lazy settle, and restoration runtime.
src/editor/             React PDF editor, persistent manifest client, and lazy thumbnail rendering.
src/popup/              React popup entry, capture controls, progress UI, and runtime clients.
src/shared/contracts/   Typed cross-context message envelopes.
src/storage/            IndexedDB and chrome.storage repositories.
tests/unit/             Fast deterministic contract, engine, coordinator, and router tests.
tests/performance/        Repeatable PDF benchmark scenarios and metric output.
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
- Run the final merge gate through the repository's read-only CI workflow after every temporary write-enabled workflow and staging file has been removed.

## Documentation

- [Product requirements](./PRD_WebCap_v1.0.md)
- [Engineering specification](./SPEC.md)
- [Implementation plan](./PLAN.md)
- [Changelog](./CHANGELOG.md)
- [PDF benchmark and integrity reference](./docs/benchmarks.md)
- [Privacy baseline](./docs/privacy.md)
- [Known capture limitations](./docs/known-limitations.md)
- [Release checklist](./docs/release-checklist.md)
- [0.1.0 release notes](./docs/release/0.1.0.md)
- [0.1.0 acceptance-criteria evidence](./docs/release/acceptance-criteria-0.1.0.md)
- [Chrome Web Store assets handoff](./docs/store-assets.md)
