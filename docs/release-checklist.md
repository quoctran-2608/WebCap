# WebCap 0.2.0 release-owner checklist

This checklist starts after PDF Engine V2 S35 has merged into `main`. It separates the already-validated technical release candidate from publication actions that still require deliberate release-owner control.

Tracking issue: #46 — `Release owner handoff — WebCap 0.2.0`.

## Approved technical candidate

- S35 merge commit on `main`: `0f4b6bb4a55a9d8bbaf1a628fdb49fcf570a1d62`.
- Validated S35 PR head: `88b60c29e793c07e6ed6d0790ad4c16d324d6866`.
- CI run `31259390923`: success.
- Release Candidate run `31259390917`: success.
- Reproducible package: `webcap-0.2.0.zip`, 1,341,084 bytes, 25 entries.
- Package SHA-256: `8bade485ee0672a2b160abf59f45c1772062ffc00724889c5aaa39294e7edb34`.
- Unit suite: 444/444 tests across 127/127 files.
- PDF performance benchmark: 4/4 PASS.
- Playwright extension E2E: 56/56 PASS on Chrome for Testing `151.0.7922.34`.
- Packaged browser compatibility: minimum, previous stable and current stable Chrome — PASS.
- Packaged lifecycle: Ubuntu, Windows and macOS — PASS, including clean install, `0.1.0 -> 0.2.0` state preservation and uninstall.
- Dependency gate: configured critical threshold PASS; `pnpm audit` reports one high-severity advisory and no critical blocker.
- Open P0/P1 search at release handoff: none found.

## Automated release gate

- [x] Frozen lockfile install and repository supply-chain policy pass.
- [x] Formatting, ESLint, strict TypeScript, privacy, dependency/license, release-metadata and configured critical-vulnerability audits pass.
- [x] Full unit suite, PDF benchmarks, production MV3 build and Playwright regression pass.
- [x] S29 original-source, S30 virtualized discovery, S33 restart/recovery, S34 adversarial viewer and S35 verified PDF UX regressions pass.
- [x] Production ZIP is reproducible from the validated candidate.
- [x] Package verification covers manifest, paths, entry metadata and release-package integrity.
- [x] Packaged compatibility passes on minimum / previous stable / current stable Chrome.
- [x] Packaged install/update/uninstall lifecycle passes on Linux, Windows and macOS.
- [x] `0.1.0 -> 0.2.0` migration preserves extension identity and supported stored state.

## Product, correctness and privacy review

- [x] PDF Engine V2 acceptance criteria AC-41–AC-60 have release traceability in `docs/release/acceptance-criteria-pdf-engine-v2.md`.
- [x] `100%` / verified rendered-PDF output is gated by durable source-page/output agreement rather than tile completion.
- [x] Original PDF bytes remain preferred when safely accessible; visible-viewer capture remains the bounded fallback.
- [x] No accepted P0/P1 correctness issue is recorded for the release candidate.
- [x] No backend, telemetry, analytics SDK, cloud sync, content upload or remote executable code is introduced.
- [x] No new required Chrome permission or default host permission is introduced by PDF Engine V2.
- [x] Diagnostics remain bounded and content-free; no page text, title, URL or filename is added to S35 PDF diagnostics.
- [x] The remaining high-severity dependency advisory is recorded accurately and is not a critical blocker under the configured gate.

## GitHub release-owner actions

- [ ] Review `docs/release/0.2.0.md` and this checklist against the exact approved candidate.
- [ ] Retain the exact `webcap-0.2.0.zip`, checksum and validation reports from the successful Release Candidate run.
- [ ] Create tag `v0.2.0` only after explicit release-owner approval.
- [ ] Create the GitHub Release from the approved tag and use the final 0.2.0 release notes.
- [ ] Attach or otherwise retain the exact reproducible ZIP/checksum/evidence required by the project release policy.
- [ ] Verify the GitHub Release points to the intended S35-complete source commit and does not silently rebuild a different package.

## Chrome Web Store — manual owner actions

- [ ] Register/verify the developer account, contact email and publisher identity.
- [ ] Host a public privacy-policy URL containing the approved policy and Limited Use statement.
- [ ] Provide a public support/homepage URL and support contact.
- [ ] Review Vietnamese and English listing copy against actual 0.2.0 behavior; do not advertise unsupported OCR, annotation, cloud or unlimited capture claims.
- [ ] Upload/review a 128x128 store icon, at least one human-reviewed 1280x800 or 640x400 screenshot, and a 440x280 small promo tile.
- [ ] Complete Privacy practices declarations so they match `docs/privacy.md`, `docs/permissions.md` and actual product behavior.
- [ ] Upload the exact approved `webcap-0.2.0.zip` and review every dashboard-parsed permission warning.
- [ ] Prefer private/trusted-tester distribution for the first external validation unless the release owner deliberately chooses broader distribution.
- [ ] Submit for review only after explicit release-owner approval.
- [ ] Do not enable automatic publication unless it is deliberately chosen.

## Version and rollback

- [x] `package.json` and `public/manifest.json` identify version `0.2.0`.
- [x] Release notes and the approved package evidence identify `0.2.0`.
- [ ] Confirm tag/GitHub Release naming uses `v0.2.0` consistently.
- [ ] Retain the exact ZIP, SHA-256, source commit and validation evidence after publication.
- [ ] If a store-uploaded build requires correction, use a strictly larger manifest version; an uploaded Chrome Web Store version number cannot be reused.
- [ ] Rollback planning must use distribution controls or a corrected higher version rather than attempting to replace an already-published `0.2.0` artifact.

Creating or merging this checklist does not itself create a tag, GitHub Release, Chrome Web Store upload, review submission or publication.
