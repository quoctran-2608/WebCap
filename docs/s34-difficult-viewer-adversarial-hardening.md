# S34 — Difficult viewer compatibility and adversarial hardening

Status: IN PROGRESS

S34 hardens PDF Engine V2 against difficult browser-hosted viewers without weakening the strict page-completion guarantees delivered in S28–S33.

## Scope

- renderer-readiness evidence for semantic and canvas viewer pages;
- lazy placeholder rejection without rejecting legitimate blank PDF pages;
- recycled/virtualized page identity hardening;
- user-input/interference regressions around page-local scroll capture;
- blank and duplicate-looking adjacent page correctness;
- auth/protected/unavailable-source viewer fallback compatibility;
- visual-discovery negative tests;
- long-running synthetic soak coverage.

## Invariants

- declared page identity remains stronger than visual similarity;
- a renderer placeholder is never accepted as completed page evidence;
- a legitimate blank page remains valid once the renderer reports a durable page surface;
- user/script scroll interference cannot store pixels for the wrong logical page;
- canvas-only discovery remains fail-closed when evidence is ambiguous;
- no backend, telemetry, remote executable code, new required Chrome permission, tag, GitHub Release, or Chrome Web Store action is introduced.

S35 remains the dedicated PDF UX, diagnostics surfacing, migration and release-candidate milestone.
