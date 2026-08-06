# WebCap 0.2.0 release-candidate checklist

## Source and scope

- [x] S21–S25 merged before S26.
- [x] Package and manifest synchronized at 0.2.0.
- [x] No new required/default host permission, backend, telemetry or remote code.
- [x] Gap audit MUST/SHOULD dispositions recorded.

## Validation

- [x] Formatting, lint, strict TypeScript, audits, unit tests and PDF benchmarks.
- [x] Verified Manifest V3 build and byte-for-byte reproducible package.
- [x] Full Playwright extension regression.
- [x] Packaged 0.1.0 → 0.2.0 settings/locale/storage migration.
- [ ] Permanent read-only CI on final documentation head.
- [ ] Minimum, previous stable and current stable Chrome package matrix.
- [ ] Linux, Windows and macOS lifecycle matrix.
- [ ] Zero unresolved review thread and zero open P0/P1.

## Publication boundary

- [x] No tag created.
- [x] No GitHub Release created.
- [x] No Chrome Web Store upload, submission or publication.
- [ ] Release-owner approval required for every publication action.
