# S23 — Adaptive auto-scroll and resumable frontier

Status: DONE
Target release: WebCap 0.2.0
Completed: 2026-08-05

## Delivered

- Incremental full-page row planning without a fixed 100,000 CSS-pixel capture stop.
- Persisted adaptive frontier advanced only after every tile in a row is durably stored.
- Resume of complete prefix rows and partially stored rows without recapturing stored columns.
- Source-document token plus document-width, viewport-size and DPR identity guards.
- Finite height growth as expected behavior; shrink, navigation or geometry drift fails safely.
- Three stable-bottom rounds plus a final probe before natural completion.
- Explicit duration, tile, byte-budget and storage partial-stop reasons.
- Incomplete-row rollback so retained output remains rectangular and continuous.
- Mode-aware coordination: full-page uses adaptive scroll while region and element retain the deterministic coordinator.
- Startup recovery after service-worker restart.
- Idempotent page-preparation responses re-enveloped with the current request ID.

## Locked safety invariants

- Frontier never advances before a complete stored row.
- Stored prefix rows are immutable and are not recaptured after growth or restart.
- A partially stored row is never exposed as completed partial output.
- Navigation, width, viewport or DPR drift cannot join tiles from different page identities.
- Infinite or device-exhausting pages end with an explicit partial reason, not silent truncation.
- Cleanup restores the source page and releases exact lifecycle ownership.
- Cached preparation payloads never reuse stale transport request IDs.

## Final evidence

- Formatting, ESLint, strict TypeScript, privacy/dependency/release/critical-security audits: PASS.
- Unit: 306/306 tests on 88 files.
- PDF performance reference: 4/4 scenarios PASS.
- Production Manifest V3 build and two-run reproducible ZIP: PASS.
- Reproducible ZIP: 1,157,200 bytes, SHA-256 `71abe04631a22d8fdebcf7b8ddfecce8475a22290a8c366ae10e04aa01cf82be`.
- Actual-browser regression: 48/48 Playwright E2E PASS in 5.8 minutes.
- Adaptive acceptance includes >100k CSS pixels, finite lazy growth, infinite max-tile partial and persisted-prefix recovery after a real extension service-worker target restart.
- Release DPR/zoom matrix and region/element/scroll-area/visible/PDF regressions: PASS.
- Packaged lifecycle on Chrome for Testing 151: clean install, simulated 0.0.9 → 0.1.0 update, stable extension ID, local storage retention and uninstall verification PASS.
- No package/manifest version or permission change; the 0.1.0 artifact boundary remains intact.

## Deferred by scope

Automatic PDF creation and mode-aware output routing remain S24. Stored-settings application, event-driven progress and popup information architecture remain S25.
