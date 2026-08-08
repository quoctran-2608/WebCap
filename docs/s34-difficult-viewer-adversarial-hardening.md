# S34 — Difficult viewer compatibility and adversarial hardening

Status: COMPLETE

S34 hardens PDF Engine V2 against difficult browser-hosted viewers without weakening the strict page-completion guarantees delivered in S28–S33.

## Implemented hardening

- added optional, backward-compatible renderer readiness evidence (`ready`, `unknown`, `placeholder`) to viewer page candidates;
- detects explicit lazy/loading states from renderer attributes, ARIA busy state, placeholder/skeleton markers, zero-sized canvases and descendant loading surfaces;
- treats durable canvas, completed image, SVG or explicit rendered state as ready evidence without requiring visible ink, so legitimate blank pages remain valid;
- prefers later ready evidence over an earlier placeholder for the same declared logical page in recycled/virtualized viewers;
- excludes explicit placeholders from final page-completion evidence while retaining older `unknown`/missing readiness evidence for protocol compatibility;
- expands PDF viewer context signals to blob-backed embed/object/iframe surfaces and PDF iframe URLs;
- preserves declared logical page identity even when adjacent pages are blank or visually identical;
- keeps S30 canvas-only discovery fail-closed behind repeated stable geometry, terminal proof and declared-count agreement when available;
- locks page-native user/script scroll interference to fail before browser pixel capture or tile persistence;
- reuses the existing S29 source-acquisition behavior for authenticated, protected and geometry-uninspectable PDFs: preserve a valid original when possible and retain visible-viewer capture as the fallback when direct acquisition is unavailable;
- adds repeated 2,000-page virtualized discovery soak coverage to guard page identity and bounded finalization behavior.

## Browser adversarial fixture

The S34 Chromium fixture contains four logical pages:

1. a legitimate blank rendered page;
2. a lazy page that starts as a renderer placeholder with a zero-sized canvas and becomes ready only after the discovery scanner reaches it;
3. a rendered page;
4. an adjacent rendered page with intentionally identical visual content to page 3.

The browser regression proves all four logical identities survive, the lazy placeholder is not accepted prematurely, and blank/duplicate-looking pages are not collapsed by visual similarity.

## Compatibility evidence

Existing regressions retained and revalidated in the S34 full suite cover:

- authenticated source returning `auth-required` without creating an original artifact while keeping viewer capture available;
- authenticated source recovery through CDP when direct fetch is denied;
- signature-valid but geometry-uninspectable/encrypted-like originals preserved without rasterizing them;
- embedded PDF discovery and permission-gated local-file source acquisition;
- invalid PDF signatures rejected;
- canvas visual discovery rejecting a single recycled viewport canvas, declared-count conflicts and unstable visual evidence;
- 500-page virtualized viewer discovery with bounded simultaneous DOM nodes;
- service-worker/offscreen recovery, OPFS streaming and multipart integrity from S33.

## Validation snapshot

CI #1289 (`31253446459`) on implementation head `3e4643600443d1ac3cd5b02f36aab77ff59786ac` / merge-test ref `b4bdd2cb52b5834ad09818e981f8e20bcb645a2b` passed:

- Prettier, ESLint and strict TypeScript;
- privacy, dependency and release audits;
- configured critical dependency gate; `pnpm audit` reported one high-severity advisory and no blocking critical finding;
- 434/434 unit tests across 124/124 files;
- 5/5 S34 viewer-hardening tests plus the page-native interference regression;
- 4/4 PDF performance benchmark scenarios;
- Manifest V3 build and reproducible package verification;
- 56/56 Playwright extension E2E tests on Chrome for Testing 151.0.7922.34, including the S34 adversarial browser fixture;
- packaged lifecycle validation including clean install, 0.1.0 → 0.2.0 update-state preservation and uninstall verification.

The reproducible package for that implementation head was `webcap-0.2.0.zip`, 1,325,238 bytes, 25 entries, SHA-256 `d445e7d15b7d374268427fb54ff2f746d301fd7d830d63b70a421c2dd439131a`.

## Invariants

- declared page identity remains stronger than visual similarity;
- a renderer placeholder is never accepted as completed page evidence;
- a legitimate blank page remains valid once the renderer reports a durable page surface;
- user/script scroll interference cannot store pixels for the wrong logical page;
- canvas-only discovery remains fail-closed when evidence is ambiguous;
- no backend, telemetry, remote executable code, new required Chrome permission, tag, GitHub Release, or Chrome Web Store action is introduced.

S35 remains the dedicated PDF UX, diagnostics surfacing, migration and release-candidate milestone.
