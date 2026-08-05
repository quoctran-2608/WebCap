# S23 — Adaptive auto-scroll and resumable frontier

Status: IMPLEMENTED, final browser and release gates pending
Target release: WebCap 0.2.0

## Delivered

- Incremental row planning without a fixed 100,000 CSS-pixel full-page stopping cap.
- Persisted adaptive frontier advanced only after a complete row is stored.
- Resume support for stored prefixes and partially stored rows without recapturing stored columns.
- Source-document token plus document-width, viewport-size and DPR identity guards.
- Finite height growth as an expected condition; document shrink or navigation fails safely.
- Three stable-bottom rounds plus a final probe before declaring natural completion.
- Explicit duration, tile, byte-budget and storage-quota partial-stop reasons.
- Incomplete-row rollback on quota or byte-budget failure so retained output remains rectangular and continuous.
- Mode-aware coordination: full-page jobs use adaptive scroll while region and element jobs retain the deterministic coordinator.
- Row-aware fixed/sticky handling and two-axis capture coverage.
- Startup recovery for eligible persisted adaptive jobs after service-worker restart.

## Safety invariants

- The committed frontier never advances before every tile in the row is stored.
- Stored prefix rows are immutable and are not recaptured after growth or restart.
- A partially stored row may resume, but it is never exposed as a completed partial result.
- Navigation, width, viewport or DPR drift cannot join tiles from different page identities.
- Infinite or device-exhausting pages end with an explicit partial reason; they are not silently truncated.
- Cleanup restores the source page and releases the exact job lifecycle ownership.

## Evidence in progress

- Formatting, ESLint, strict TypeScript, privacy/dependency/release/critical-security audits: PASS.
- Unit suite: 305 tests, including adaptive planner, stable-end, finite growth, partial-row resume, navigation guard and persisted recovery.
- PDF benchmarks: 4/4; production build and reproducible ZIP: PASS.
- Actual-browser cases added for a page beyond 100k CSS pixels, finite lazy growth, infinite max-tile partial and service-worker restart recovery.
- Full 48-case Playwright regression and packaged lifecycle remain the final core gate.

## Deferred by scope

Automatic PDF creation and mode-aware output routing remain S24. Stored-settings application, event-driven progress and popup information architecture remain S25.
