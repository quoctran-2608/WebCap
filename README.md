# WebCap

WebCap is a local-first Chrome extension for capturing everything a web page presents: the visible viewport, a full page, a selected region, a DOM element, or a scrollable area. Long captures are processed in tiles and can be exported as images or multi-page PDF files without uploading page content to a server.

> The repository is in active implementation. Product scope is defined in [`PRD_WebCap_v1.0.md`](./PRD_WebCap_v1.0.md), technical contracts in [`SPEC.md`](./SPEC.md), and session-sized work in [`PLAN.md`](./PLAN.md).

## Current status

**S13 — Paged PDF export foundation is complete.** WebCap can now convert a stored logical tile set into A4, Letter, or fit-width PDF pages using pure physical-unit conversion, continuous CSS page slicing, running fractional pixel ranges, and strict tile-to-page intersection coverage. The offscreen exporter allocates only one PDF-page-sized canvas, decodes one tile at a time, JPEG-encodes each page, embeds it with local `pdf-lib`, releases page resources, and persists the final `application/pdf` Blob with page count and export progress. Automated coverage reloads a real generated PDF, rejects gaps/overlaps, verifies exact final pixel coverage, preserves source tiles on failure, and completes a real 9,600 CSS-pixel browser export. PDF remains hidden in the popup until S14 adds the editor, options, retry, and download UX.

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
pnpm dev           # Run the popup entry with the Vite development server.
pnpm build         # Build and verify the Manifest V3 unpacked extension.
pnpm typecheck     # Run TypeScript without emitting files.
pnpm lint          # Run ESLint with zero warnings allowed.
pnpm format:check  # Verify formatting without modifying files.
pnpm format        # Format tracked source/configuration files.
pnpm test:unit     # Run the unit-test suite once.
pnpm test:smoke    # Smoke-test the built popup ↔ service-worker handshake in Chrome.
pnpm test          # Run Vitest in watch mode.
pnpm package       # Build and verify the unpacked extension; ZIP packaging comes later.
```

## Load the extension in Chrome

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the generated `dist/` directory.
6. Open the WebCap action popup and confirm that **Service worker** shows **Đã kết nối**.

The `dist/` output contains `manifest.json`, `popup.html`, `service-worker.js`, `content-script.js`, `offscreen.html`, `offscreen.js`, hashed popup assets, and the four extension icons. Generated output, dependency directories, test reports, and local browser profiles must not be committed.

## Source structure

```text
public/                 Manifest and static extension assets copied as-is.
assets/                 Internal build-time icon sources.
src/background/         Manifest V3 service worker, job routing, capture coordination, and Chrome adapters.
src/capture/            Page measurement, deterministic tile planning, and capture engines.
src/content/            On-demand page preparation, lazy settle, and restoration runtime.
src/popup/              React popup entry, capture controls, progress UI, and runtime clients.
src/shared/contracts/   Typed cross-context message envelopes.
src/storage/            IndexedDB and chrome.storage repositories.
tests/unit/             Fast deterministic contract, engine, coordinator, and router tests.
tests/e2e/              Playwright unpacked-extension integration tests.
tests/smoke/            Real-Chrome unpacked-extension smoke tests.
scripts/                Build verification and repository automation.
```

## Development rules

- Keep TypeScript strict; do not introduce `any` without an adapter-boundary justification.
- Add or update tests in the same change as behavior.
- Do not add Chrome permissions, remote scripts, analytics, or backend calls outside the approved PRD/SPEC scope.
- Complete only the active session in `PLAN.md`; defer unrelated work instead of expanding the current change.

## Documentation

- [Product requirements](./PRD_WebCap_v1.0.md)
- [Engineering specification](./SPEC.md)
- [Implementation plan](./PLAN.md)
- [Changelog](./CHANGELOG.md)
- [Privacy baseline](./docs/privacy.md)
