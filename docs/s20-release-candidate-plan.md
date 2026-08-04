# S20 release candidate and store readiness plan

## Goal

Produce a reproducible, installable, testable WebCap 0.1.0 release candidate with complete technical release evidence, without publishing to the Chrome Web Store or creating a public release/tag.

## Required deliverables

- Deterministic ZIP with `manifest.json` at archive root, fixed entry ordering/metadata, no source maps or development output, SHA-256 checksum, and a machine-readable release manifest.
- Manifest audit covering version synchronization, Chrome version format, minimum Chrome 116, exact required/optional permissions, locale metadata, icon dimensions, and forbidden store/package fields.
- Packaged lifecycle smoke covering clean-profile install, same-profile update from an older version fixture, preserved local settings, and self-uninstall without adding the `management` permission.
- Release workflow that runs the complete quality gate, tests the packaged extension on the supported browser matrix, and uploads artifacts only.
- Release checklist, known limitations, privacy/store listing copy, release notes, dependency/security evidence, and acceptance-criteria traceability.
- Version `0.1.0` synchronized between `package.json` and the extension manifest.

## Validation gate

- Frozen-lockfile install and supply-chain policy verification.
- Formatting, ESLint, strict TypeScript, privacy/license/security audits.
- Unit, PDF benchmark, production build, full Playwright regression suite.
- Byte-for-byte package reproducibility and package integrity verification.
- Clean-profile packaged install/update/uninstall smoke.
- Minimum Chrome 116 and current stable packaged smoke where compatible with the CI runner.
- No unresolved P0/P1 defect or critical dependency alert.

## Explicit non-goals

- New capture/export functionality.
- Chrome Web Store submission or credential handling.
- Git tag, GitHub Release, CRX signing, external update server, or auto-publish.
- New runtime permission, default host permission, telemetry, backend, account, or cloud sync.
