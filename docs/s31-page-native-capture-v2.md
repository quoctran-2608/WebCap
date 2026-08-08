# S31 — Page-Native Capture Engine V2

## Goal

S31 changes PDF viewer capture from a document-wide tile plan into a logical-page pipeline. A verified S30 `DocumentPageMap` becomes the capture boundary: WebCap plans and captures one logical page at a time, groups pages into bounded adaptive batches, verifies that a page is complete, and only then advances to the next page.

This milestone addresses AC-44, AC-48, AC-49, and AC-56 while preserving the S27–S30 guarantees for one-source-page-to-one-output-page mapping and mixed page orientation.

## Routing

`ScrollAreaCaptureEngine` remains the public scroll-area engine used by the existing coordinator. It now acts as a small facade:

- ordinary scroll targets continue through the unchanged generic scroll-area engine;
- PDF/document/viewer-like targets attempt S31 page-native capture;
- S31 requires a complete, high-confidence semantic S30 page map;
- when independent page evidence is unavailable, the engine falls back to the existing generic scroll-area implementation.

No new browser permission or host permission is required.

## Page-local planning

`planPdfPageCaptureTiles` plans only one logical page. It clamps scroll positions to the real viewer scroll range while keeping every output rectangle inside the page rectangle from S30. Pages smaller than the viewport require one screenshot; a giant logical page may use an internal two-dimensional tile grid.

A page has its own bounded tile budget. If a single page cannot be captured safely within that page-local budget, S31 fails that page explicitly instead of truncating the document or pretending the page is complete.

## Adaptive batches

`AdaptivePageBatchController` selects a bounded group of pages for the next batch using:

- a target number of pages per batch;
- estimated tile count;
- estimated raster bytes;
- observed batch duration and storage pressure.

Healthy small batches may grow conservatively. Slow or pressured batches shrink. A very large page is allowed to become a one-page batch so the document is never rejected merely because one page is larger than the normal batch target.

Only the current batch's new plans are materialized at once. Stored raster blobs are handed to the tile repository immediately and are not retained by S31 after storage. Document-wide metadata may grow with the number of logical pages, but active raster ownership remains bounded by the current page/current batch.

The synthetic regression covers 2,000 logical pages and verifies forward progress across many batches without a document-wide tile-count completion cap.

## Page verification

For every logical page, S31:

1. scrolls to each page-local tile position;
2. waits for stable viewer geometry;
3. rejects scroll snapping or unstable page geometry;
4. captures the visible viewport;
5. validates stable screenshot scale;
6. stores the tile immediately;
7. verifies that the union of stored output rectangles completely covers the logical page.

The engine does not advance to the next page until that coverage proof succeeds. A page-boundary progress event always references the verified final stored tile of that page, so it cannot report a synthetic or undefined tile boundary.

The page-native stability check follows the existing scroll-area protocol exactly: `stableSamples >= 1` means the content runtime observed one repeated unchanged geometry sample after the initial sample. Requiring a higher number would contradict the protocol because the content runtime intentionally stops settling as soon as that first repeated stable sample is observed.

Incremental `onPlan` updates preserve already-stored tile status and `completedTiles`; progress cannot move backwards merely because the next batch was planned.

S30 discovery is restricted to the genuine initial measurement probe. Page-native capture tiles cannot accidentally trigger another full viewer-discovery pass when their coordinates happen to be `(0, 0)`.

## Stop and keep-partial semantics

A normal cancellation remains immediate. For a user stop that requests keeping partial output, cancellation is deferred only while the current logical page is in progress. S31 finishes and verifies that page, then honors the cancellation before starting the next page.

The coordinator therefore receives a contiguous stored prefix ending on a complete logical page boundary. Existing partial-export page filtering can then produce a partial PDF containing only fully captured pages.

## Compatibility and safety boundary

S31 does not implement:

- S32 OPFS raster spool;
- S32 quota recovery or resume;
- S33 streaming PDF writing;
- S33 multipart output;
- a full-document canvas or bitmap;
- backend services, telemetry, accounts, cloud sync, or remote executable code.

The generic scroll-area engine remains available unchanged as the compatibility fallback. S29 original-source acquisition and S30 logical-page discovery remain intact.

## Validation gates

Before merge, the exact PR head must pass:

- Prettier, ESLint, and strict TypeScript;
- privacy, dependency, release, and critical security gates;
- all unit tests, including 2,000-page batching and page-boundary stop regressions;
- PDF performance benchmarks;
- Manifest V3 build and reproducible ZIP verification;
- the full Playwright extension suite, including the mixed portrait/landscape PDF viewer regression;
- packaged install/update/uninstall lifecycle smoke.
