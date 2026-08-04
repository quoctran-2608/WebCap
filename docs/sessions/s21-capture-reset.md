# S21 — Capture reset and new-capture lifecycle

Status: DONE pending merge of PR #26  
Target release: WebCap 0.2.0  
Implementation branch: `agent/s21-capture-reset`

## Delivered

- Typed reset request/response contracts for visible session, job and tab scopes.
- Central reset orchestration and capture-owned cleanup services.
- Safe cancellation and idle waiting for active full-page, scroll-area, PDF and visible-image work.
- Selector close messages for region and element selection.
- Late image/PDF output deletion after reset.
- Minimal popup actions for active and terminal reset states.

## Safety invariants

- Never delete another job because it shares a tab.
- Never delete settings, locale or downloaded files.
- Never remove persistent data before active work has reached an idle boundary.
- Never present partial cleanup as complete without a warning.
- Replaying a reset request is safe.

## Evidence

- Format, strict TypeScript, ESLint and production build: PASS.
- Unit: 290/290 across 83 files before E2E/document synchronization.
- Added E2E: visible reset and second capture; terminal and active full-page reset with page restoration and zero stale job/tile data.
- Full repository read-only CI, audits, PDF benchmarks, E2E and packaged lifecycle are the final merge gate.

## Deferred by scope

Adaptive scrolling, selector visual redesign, automatic PDF orchestration, settings source-of-truth and popup information architecture remain S22–S25 work.
