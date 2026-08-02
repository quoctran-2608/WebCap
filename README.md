# WebCap

WebCap is a local-first Chrome extension for capturing everything a web page presents: the visible viewport, a full page, a selected region, a DOM element, or a scrollable area. Long captures are processed in tiles and can be exported as images or multi-page PDF files without uploading page content to a server.

> The repository is in active implementation. Product scope is defined in [`PRD_WebCap_v1.0.md`](./PRD_WebCap_v1.0.md), technical contracts in [`SPEC.md`](./SPEC.md), and session-sized work in [`PLAN.md`](./PLAN.md).

## Current status

**S00 — Foundation** establishes the TypeScript workspace and quality toolchain. Chrome extension entry points and the Manifest V3 build are intentionally introduced in S01.

## Requirements

- Node.js 22.12 or newer.
- Corepack enabled.
- pnpm version declared by the `packageManager` field in `package.json`.

## Setup

```bash
corepack enable
corepack install
pnpm install --frozen-lockfile
```

## Commands

```bash
pnpm dev           # Run the current Vite development entry.
pnpm build         # Build the current foundation library entry.
pnpm typecheck     # Run TypeScript without emitting files.
pnpm lint          # Run ESLint with zero warnings allowed.
pnpm format:check  # Verify formatting without modifying files.
pnpm format        # Format tracked source/configuration files.
pnpm test:unit     # Run the unit-test suite once.
pnpm test          # Run Vitest in watch mode.
pnpm package       # Explain the packaging boundary until S01.
```

## Foundation structure

```text
src/shared/       Pure reusable modules and future shared contracts.
tests/unit/       Fast deterministic unit tests.
scripts/          Repository automation that does not belong in runtime code.
```

The generated `dist/`, dependency directories, test reports, and local browser artifacts must not be committed.

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
