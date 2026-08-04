# WebCap 0.1.0 release checklist

This checklist prepares an internal release candidate and Chrome Web Store submission package. Completing it does not publish the extension.

## Final automated evidence

- Validation source head: `3fb083fc0e8779cc5e7b25cec107c148246bd1cc`.
- Read-only CI run: `30909732983` — success.
- Release Candidate run: `30909732939` — success.
- Package: `webcap-0.1.0.zip`, 1,097,035 bytes, 24 entries.
- Package SHA-256: `630c44c07e72da0d5edc1c82c013ecf6caf995e0542ee19679380081e7b0cb7a`.
- Packaged lifecycle: Linux, Windows, macOS, Chrome 116.0.5845.96, and Chrome stable 151.0.7922.71 — success.
- Regression gate: 279 unit tests/79 files, four PDF benchmarks, verified Manifest V3 build, and 38 Playwright E2E cases — success.
- Triage: zero open P0/P1, zero critical dependency advisory, and no unresolved review thread.

## Automated release gate

- [x] Frozen lockfile installs without mutation and passes the pnpm supply-chain policy.
- [x] Formatting, ESLint, strict TypeScript, privacy, dependency/license, release-metadata, and critical-vulnerability audits pass.
- [x] Unit, PDF benchmark, production build, full Playwright regression, and DPR/zoom release matrix pass.
- [x] The production ZIP is generated twice from the same commit and is byte-identical.
- [x] ZIP checksum, release manifest, entry hashes, CRC values, paths, timestamps, permissions, icons, locales, CSP-sensitive JavaScript, and root `manifest.json` pass verification.
- [x] The packaged ZIP installs in a clean profile, upgrades over the `0.0.9` fixture without losing `chrome.storage.local`, and self-uninstalls without requesting `management`.
- [x] Packaged smoke passes on Chrome 116 and the current stable Chrome for Testing build used by CI.
- [x] CI uploads the ZIP, SHA-256 file, release manifest, lifecycle reports, and Playwright report. Generated files are not committed.

## Product and security review

- [x] Every PRD MUST acceptance criterion has automated or documented manual evidence.
- [x] No open P0/P1 defect, data-loss bug, missing-content bug, repeated-content bug, restore failure, or leaked debugger attachment.
- [x] Every remaining P2 limitation is listed with a practical workaround.
- [x] No runtime remote code, analytics SDK, content upload, default host permission, account, cloud sync, or remote diagnostics path.
- [x] Required permissions and optional host patterns match `docs/permissions.md` and the store disclosures.
- [x] Privacy copy describes local processing, temporary retention, user controls, diagnostics, original-PDF fetches, and Limited Use accurately.
- [x] Dependency inventory and critical vulnerability audit have been reviewed for this exact lockfile.

## Chrome Web Store dashboard — manual owner actions

- [ ] Register/verify the developer account, contact email, and publisher identity.
- [ ] Host a public privacy-policy URL containing the approved policy and Limited Use statement.
- [ ] Provide a public support/homepage URL and support contact.
- [ ] Paste the approved Vietnamese and English listing copy; choose the Product category and distribution audience.
- [ ] Upload a 128×128 store icon, at least one human-reviewed 1280×800 screenshot, and a 440×280 small promo tile. Do not use misleading claims or unreviewed placeholder artwork.
- [ ] Complete the Privacy practices declarations so they match product behavior and the published privacy policy.
- [ ] Upload `webcap-0.1.0.zip`, verify the dashboard parses the manifest, and review every permission warning.
- [ ] Use private or trusted-tester distribution for the first external validation.
- [ ] Submit for review only after explicit release approval. Do not enable automatic publication unless deliberately chosen.

## Version and rollback

- [x] `package.json`, packaged `manifest.json`, release notes, checksum filename, and release manifest all say `0.1.0`.
- [x] Any changed package uploaded after `0.1.0` uses a strictly larger manifest version.
- [x] Retain the exact ZIP, SHA-256, release manifest, test reports, source commit, and rollback notes.
- [x] Rollback means disabling distribution or uploading a corrected higher version; an already uploaded Chrome Web Store version number cannot be reused.
