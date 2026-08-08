# S35 — Dedicated PDF UX, verification and release candidate

Status: COMPLETE

Baseline: `main` after S34 merge commit `4e225bf5f1b0dc1737fa663cb2c78786c8af7b73`.

S35 closes PDF Engine V2 by surfacing the durable page-oriented evidence from S28–S34 as user-facing UX without weakening any engine invariant.

## Delivered

- dedicated rendered-PDF suggestion when original-source acquisition is unavailable but the visible viewer remains capturable;
- page-first capture, verification, streamed-writer, pause and completed states in the popup;
- metadata-only `PDF_MANIFEST_GET` and retryable `JOB_RESUME` handled by a dedicated router;
- routing ownership guard so the generic background router cannot consume S35 requests;
- S33 recovery reuse for paused page-native capture and paused streamed PDF output;
- verified result labeling only from a completed durable manifest with exact discovered/captured/verified/output agreement;
- bounded diagnostics containing only strategy, manifest state, viewer-adapter bucket and page counters;
- backward compatibility for pre-manifest jobs through durable `CaptureJob` progress without data migration;
- real-browser validation that a three-page mixed-orientation viewer produces a valid three-page PDF and then renders `3/3 trang đã xác minh`;
- AC-41–AC-60 traceability in `docs/release/acceptance-criteria-pdf-engine-v2.md`.

## Validation — clean read-only CI `31258825875`

- Prettier: PASS.
- ESLint: PASS.
- strict TypeScript: PASS.
- privacy/dependency/release audits: PASS.
- configured critical dependency gate: PASS; one high-severity advisory remains, with no critical blocker.
- unit tests: **444/444** across **127/127** files.
- PDF performance benchmarks: **4/4 PASS**.
- Manifest V3 build: PASS.
- reproducible package: `webcap-0.2.0.zip`, **1,341,084 bytes**, 25 entries, SHA-256 `8bade485ee0672a2b160abf59f45c1772062ffc00724889c5aaa39294e7edb34`.
- Playwright extension E2E: **56/56 PASS** on Chrome for Testing `151.0.7922.34`.
- S35 verified viewer UX regression: PASS.
- S34 difficult-viewer/adversarial fixture: PASS.
- S33 forced service-worker/offscreen recovery regressions: PASS.
- S30 500-page virtualized viewer regression: PASS.
- S29 byte-identical original-source regression: PASS.
- packaged lifecycle: PASS, including clean install, `0.1.0 → 0.2.0` state preservation and uninstall.

## Invariants and publication boundary

- S28–S34 correctness remains authoritative; S35 only surfaces durable evidence.
- `100%`/verified result is never inferred from tile completion alone.
- No IndexedDB schema migration is introduced by S35.
- No new required Chrome permission, backend, telemetry, account, cloud dependency or remote executable code is introduced.
- No tag, GitHub Release or Chrome Web Store action is included.
