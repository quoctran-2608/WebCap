# S18 Capture Hardening Plan

## Goal

Make the existing capture engines deterministic and honest across the MVP edge-case fixture matrix without expanding into S19 diagnostics/i18n or unsupported protected-content work.

## Required behavior

- Bound lazy/infinite growth by stable-height, duration, CSS height, tile count, and explicit user cancellation.
- Never silently truncate. Persist a machine-readable completion reason and surface a partial-capture warning when a guard stops growth.
- Disable scroll snapping only while WebCap controls scrolling and restore it compare-before-restore.
- Require a bounded layout-settle decision before measurement/capture.
- Validate same-origin and cross-origin iframe pixels without promising cross-origin DOM access.
- Validate canvas and WebGL output through deterministic local fixtures.
- Cover selected DPR/zoom combinations and retain the existing one-device-pixel boundary guarantees.

## Implementation order

1. Audit current page preparation, fallback capture, job metadata, popup progress, and fixture server.
2. Add pure growth/settle/limit decision modules with unit tests.
3. Integrate bounded preparation and explicit partial completion metadata.
4. Add restoration-safe scroll-snap/layout-shift mitigation.
5. Add iframe/canvas/WebGL/lazy/infinite/scroll-snap/layout-shift fixtures and browser assertions.
6. Run format, lint, strict typecheck, unit, benchmark, production build, and full Playwright extension suite.
7. Review the final diff for generated output, debug logging, temporary workflows, and out-of-scope changes.

## Explicit non-goals

- DRM or protected-video bypass.
- Browser-internal restricted-page workarounds.
- Cross-origin iframe DOM inspection.
- New remote services, analytics, permissions, dependencies, or storage migrations without a separately justified change.
