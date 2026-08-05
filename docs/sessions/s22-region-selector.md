# S22 — Reliable and accessible region selector

Status: DONE; PR #27 pending merge
Target release: WebCap 0.2.0

## Delivered

- Selector-ready acknowledgement only after the root is attached, listeners are installed, the dialog is focused, and the first animation frame has rendered.
- Popup close only after the ready acknowledgement; launch errors keep the popup available with typed guidance.
- Two-second launch timeout with S21 capture-reset cleanup for failed injection or readiness.
- Atomic duplicate-open handling with one selector root and stable selector-instance identity.
- Visible dim mask and crosshair with pointer create, move, eight-handle resize, and two-axis edge auto-scroll.
- Keyboard creation through Space or toolbar fallback, arrow-key movement, Alt resize, Shift acceleration, Enter commit, and Escape cancellation.
- Resize-handle hit targets of at least 24 CSS pixels.
- Selector removal and two animation frames before capture begins.
- Explicit stacking order that keeps the floating toolbar interactive above the selected rectangle.

## Safety invariants

- A ready response never means merely that the content message was received.
- A launch failure leaves no job, tile, artifact, selector root, summary, or tab lease.
- Duplicate opens for the same job reuse one selector instance; a different job cannot replace it.
- Confirm, cancel, timeout, injection failure, and page exit restore selector-owned state.
- Selector UI cannot appear in captured pixels.

## Evidence

- Formatting, ESLint, strict TypeScript, privacy/dependency/release/critical-security audits, and production build: PASS.
- Unit: 295/295 across 84 files, including contracts, readiness timeout, keyboard geometry, duplicate responses, and S21 reset routing on launch failure.
- PDF benchmark: 4/4 scenarios; reproducible release ZIP: PASS.
- Browser: 44/44 Playwright E2E, including popup-close ordering, focused readiness, duplicate opens, pointer and keyboard flows, 24-pixel handles, two-axis auto-scroll, DPR/zoom stability, overlay exclusion, page restoration, and zero-orphan launch failure.
- Packaged install/update/storage-retention/uninstall lifecycle smoke: PASS.
- The final merge gate runs from the clean 19-file diff with read-only GitHub Actions permissions.

## Deferred by scope

Adaptive full-page scrolling, region image/PDF output routing, stored settings, event-driven progress, and popup information architecture remain S23–S25 work.
