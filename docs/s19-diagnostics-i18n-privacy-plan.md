# S19 Diagnostics, i18n, privacy, permissions, and accessibility plan

## Goal

Complete the pre-release trust and usability layer without adding telemetry, accounts, cloud sync, remote services, broad host access, or unrelated S20 packaging work.

## Required behavior

- Provide complete Vietnamese and English copy for popup, editor, selectors, permission rationale, restricted-page guidance, and every user-facing error key.
- Resolve locale deterministically with Vietnamese and English fallback behavior that does not expose raw translation keys.
- Produce copyable safe-diagnostics JSON containing only approved technical metadata; redact URLs, page text, image data, credentials, tokens, cookies, selectors, and binary payloads.
- Keep production logging at `warn` or stricter and audit every structured context field through a single redaction boundary.
- Explain sensitive permissions at the moment they are needed and preserve image-capture fallbacks when optional permission is denied.
- Complete local-first privacy documentation and prove that normal capture/export flows make no analytics or content-upload request.
- Complete keyboard, focus, semantic-label, live-region, and contrast checks for popup, editor, region selector, element selector, and scroll-area selector.
- Add deterministic dependency and license inventory checks suitable for the release gate.

## Validation

- Unit tests for locale selection, interpolation, fallback, diagnostics allowlisting/redaction, logger production behavior, and permission/restricted-page copy.
- Browser tests for language switching/persistence, copy-diagnostics action, keyboard-only flows, screen-reader-visible status/errors, and optional-permission denial fallback.
- Static scans for remote URLs, analytics endpoints, unsafe logging fields, production debug/info calls, dependency metadata, and incompatible/missing licenses.
- Full formatting, lint, strict typecheck, unit, PDF benchmark, Manifest V3 build, and Playwright regression gate.

## Explicit non-goals

- Telemetry backend or product analytics collection.
- Accounts, cloud sync, remote storage, or remote diagnostics upload.
- New required Chrome permissions or default host permissions.
- Release ZIP/version/tag/store submission work reserved for S20.
