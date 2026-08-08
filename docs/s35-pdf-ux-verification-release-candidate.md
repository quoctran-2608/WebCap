# S35 — Dedicated PDF UX, verification and release candidate

Status: IMPLEMENTATION IN PROGRESS

Baseline: `main` after S34 merge commit `4e225bf5f1b0dc1737fa663cb2c78786c8af7b73`.

S35 is the final PDF Engine V2 milestone. It does not replace the page-oriented engines delivered in S28–S34; it exposes their state honestly to the user, adds an explicit resume surface for retryable pauses, keeps diagnostics content-free, and closes the release-candidate UX/compatibility boundary.

## Delivered in this branch

- dedicated viewer-PDF suggestion when original-source acquisition is unavailable but the rendered viewer is capturable;
- a page-first popup companion showing capture, verification, writer and paused states without exposing tile internals;
- retryable `JOB_RESUME` for paused page-native capture or paused streamed PDF output;
- read-only `PDF_MANIFEST_GET` so the popup can surface the existing S28 `PdfDocumentManifest` without changing its storage schema;
- strict result explanation only when discovered/captured/verified/output counts agree with the completed manifest;
- bounded allowlisted PDF diagnostics: strategy, manifest state, viewer-adapter bucket and page counters only;
- backward compatibility when an older job has no PDF manifest: UI falls back to durable `CaptureJob` page/export progress and does not migrate or rewrite stored data;
- focused unit coverage for verified completion, legacy fallback, pause/resume eligibility, protocol contracts and diagnostic redaction.

## S35 invariants

1. S28–S34 correctness remains authoritative; the popup never manufactures completion evidence.
2. `100%` in the dedicated PDF surface requires the page/output progress represented by the durable manifest or the existing job fallback while work is still in progress.
3. A verified result label requires manifest state `completed`, output state `completed`, exact discovered/captured/verified source counts, and output count matching the verified output plan.
4. Resume is offered only for retryable `paused` work and reuses S33 recovery paths.
5. No new IndexedDB schema, Chrome required permission, backend, telemetry, account, cloud dependency or remote executable code is introduced.
6. Diagnostics never include page text, URLs, filenames, document titles or raw viewer identifiers.
7. Original-source download remains preferred when safely available; viewer capture is the fallback UX rather than a competing default.

## Validation target

The final S35 candidate must pass:

- Prettier;
- ESLint;
- strict TypeScript;
- privacy/dependency/release/security audits;
- complete unit suite plus S35 focused regressions;
- 4/4 PDF benchmarks;
- Manifest V3 production build;
- reproducible package verification;
- complete Playwright extension E2E matrix;
- long-PDF compatibility/recovery matrix retained from S29–S34;
- packaged install, `0.1.0 -> 0.2.0` update-state preservation and uninstall lifecycle.

No tag, GitHub Release, Chrome Web Store submission, review request or publication is part of S35 implementation without separate explicit release-owner approval.
