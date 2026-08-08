# WebCap PDF Engine V2 — Comprehensive browser PDF capture roadmap

Status: PLANNED  
Baseline: S27 dedicated page-aware PDF capture on `main`  
Target sessions: S28–S35  
Primary goal: make browser-hosted PDF handling a first-class WebCap engine rather than a special case of generic scroll capture.

## 1. Product outcome

A user opens a PDF or PDF-like document in a browser and chooses one simple action: **Capture / save this PDF**. WebCap chooses the safest and highest-fidelity strategy automatically.

The strategy ladder is:

1. **Original source passthrough** — preserve the original PDF bytes when WebCap can access them safely.
2. **Page-aware viewer capture** — capture the rendered viewer page-by-page when source bytes are unavailable or the user needs the visible rendered state.
3. **Incremental visual page discovery** — discover page boundaries while scrolling when the viewer virtualizes/recycles DOM or exposes only canvas pixels.
4. **Page-aligned multipart fallback** — only when browser storage/output limits make one artifact impossible; never split a logical source page.

The user must never need to understand tiles, browser virtualization, page projection, batching, IndexedDB, OPFS, or output memory limits.

## 2. Non-negotiable invariants

1. One logical source page maps to exactly one output page when viewer capture is used.
2. No output page break may occur inside a detected logical source page.
3. Tile count is an implementation detail and can never prove document completion.
4. No global tile-count limit is used as the normal end condition for a PDF document.
5. Capture progress is page-oriented: discovered, captured, verified, output.
6. `100%` is shown only after strict completion verification.
7. Mixed page sizes and portrait/landscape orientation are preserved independently per page.
8. Viewer gutters, dark background, toolbar, shadows, and inter-page gaps are not page content.
9. A single very large page may be internally tiled, but only that page is assembled at one time.
10. Full-document raster canvases are forbidden.
11. Decoded raster memory remains bounded independently of total document length.
12. Service-worker/offscreen restart must resume from a durable page checkpoint without recapturing verified pages.
13. Width/DPR/pixel-scale/source identity drift remains a hard correctness guard.
14. Stop/partial output ends on a complete logical page boundary whenever a page map exists.
15. Original source is preferred for fidelity, but viewer capture remains available for authenticated, encrypted/unlocked, blob-backed, annotated, or otherwise non-downloadable documents.
16. No backend, telemetry, account, cloud sync, remote executable code, new required permission, or default host permission is introduced.

## 3. Architecture

```text
User action: Capture PDF
        |
        v
+--------------------------+
| PdfCaptureOrchestrator   |
+------------+-------------+
             |
   +---------+----------+------------------+
   |                    |                  |
   v                    v                  v
Source acquisition   Viewer adapter    Visual discovery
(original bytes)     (semantic pages)  (incremental pages)
   |                    |                  |
   +---------+----------+------------------+
             |
             v
+--------------------------+
| PdfDocumentManifest      |
| page identity + state    |
+------------+-------------+
             |
             v
+--------------------------+
| AdaptivePageBatcher      |
+------------+-------------+
             |
             v
+--------------------------+
| PageNativeCaptureEngine  |
| page-at-a-time tiling    |
+------------+-------------+
             |
             v
+--------------------------+
| PdfSpoolStore (OPFS)     |
| durable page/output data |
+------------+-------------+
             |
             v
+--------------------------+
| StreamingPdfWriter       |
| no full-document canvas  |
+------------+-------------+
             |
             v
+--------------------------+
| CompletionVerifier       |
+------------+-------------+
             |
             v
Download / multipart fallback
```

## 4. Strategy selection

### Strategy A — original PDF source

Use when the real PDF bytes are accessible and the visible viewer state does not require raster recapture.

Source probes, in priority order:

- active tab URL / response content type / `%PDF-` signature;
- `iframe`, `embed`, `object`, and viewer source metadata;
- same-origin or permission-granted blob/source URL;
- authenticated GET with browser credentials and explicit host permission;
- user-initiated active-tab CDP/network response recovery only where already permitted by WebCap's existing debugger permission and only for PDF response bodies;
- file URL when Chrome file access is enabled.

Large originals must stream to disk-backed local storage rather than accumulating all bytes in RAM. The current fixed original-byte memory-style guard becomes a streaming safety policy based on storage availability, not a hard normal-size cutoff.

### Strategy B — semantic viewer capture

Use a viewer adapter that can expose logical page count and/or page rectangles.

Initial adapters:

- PDF.js-style viewers (`.page`, `data-page-number`, loaded/rendering state);
- Chromium/native viewer signals that are reachable from the active PDF tab;
- open shadow-root page trees;
- same-origin nested/embedded PDF viewers;
- generic paged viewers exposing stable numbered page containers.

### Strategy C — incremental visual discovery

Use when DOM is virtualized/recycled or canvas-only.

Page discovery works incrementally around the current viewport. It does not require all page nodes to exist at once. A page boundary candidate is accepted only after repeated geometry/visual confirmation and a confidence threshold.

Signals can include:

- large page-like connected rectangles;
- stable contrast between page surface and viewer background;
- consistent left/right edges;
- stable top/bottom edges over two settled samples;
- viewer page-number indicators when available;
- scroll-order continuity;
- declared total page count if exposed independently.

Uniform-rhythm projection remains only a bounded fallback hint, never the sole proof of completion for an unknown virtualized document.

## 5. Durable document model

Introduce a versioned `PdfDocumentManifest` separate from generic `CaptureJob` tile semantics.

Minimum fields:

```text
schemaVersion
jobId
sourceIdentity
sourceStrategy
viewerAdapter
expectedPageCount?
discoveryComplete
pages[]:
  index
  identity
  sourceRectCss?
  widthCss
  heightCss
  orientation
  discoveryConfidence
  state: discovered | capturing | captured | verified | written
  captureFingerprint?
  spoolReference?
currentBatch
lastVerifiedPage
outputState
createdAt / updatedAt / expiresAt
```

Page identity must survive DOM recycling. It is based on stable declared page index when available, otherwise sequence + geometry/source fingerprint evidence.

## 6. Adaptive page batching

Replace document-wide tile planning with page-native batching.

`DEFAULT_MAX_TILES` remains relevant to generic web capture. For PDF V2, resource planning occurs per page and per batch.

Batch size is selected from:

- page dimensions and DPR;
- estimated encoded page bytes;
- current heap pressure;
- `navigator.storage.estimate()` quota/usage;
- OPFS availability;
- measured capture/encode latency;
- remaining pages;
- recent batch success/failure.

Example behavior:

```text
Low-resource device  -> 3–5 pages/batch
Normal desktop       -> 10–25 pages/batch
Small lightweight PDF -> larger batch
One giant page        -> one page, internally tiled
```

The batch controller can shrink immediately after memory/storage pressure. It may grow conservatively after several healthy batches.

There is no normal whole-document tile cap. Safety is enforced through per-page/per-batch budgets, storage quota, source identity, elapsed-session policy, and explicit pause/resume.

## 7. Page-native capture

For each logical page:

1. navigate/scroll until the page is capturable;
2. wait for viewer stability;
3. verify page identity;
4. capture the page in one shot if it fits safely;
5. otherwise tile only inside that page rectangle;
6. assemble only the current page surface;
7. encode the page;
8. persist to spool storage;
9. verify the persisted page;
10. release canvas/bitmap/tile memory before the next page.

A viewer stability policy must distinguish real source/layout change from normal PDF lazy rendering.

Readiness signals include adapter-specific loaded state, mutation quiet period, stable dimensions, stable scroll target, and optional repeated rendered fingerprint. Blank source pages must still be accepted as valid pages.

## 8. Disk-backed spool and streaming PDF output

### OPFS-first spool

Use Origin Private File System from the offscreen document when available. IndexedDB remains the metadata store and fallback for small artifacts.

Spool goals:

- page raster data is durable without occupying heap;
- worker restart does not lose verified pages;
- output generation reads one page at a time;
- completed page capture data can be reclaimed after the corresponding output segment becomes durable.

### Streaming PDF writer

Add a raster PDF writer designed for append-style page generation instead of relying on a final full-document in-memory model.

For viewer-captured pages:

- encode each page as a PDF-compatible image stream;
- write page/image/content objects sequentially;
- track object offsets in compact metadata;
- finalize xref/trailer after the final page;
- checkpoint writer offset/object state so an offscreen restart can safely truncate to the last durable boundary and continue.

The writer must preserve exact per-page aspect ratio and orientation.

`pdf-lib` remains useful for validation/small-file operations and original-source inspection, but must not be the only mechanism for arbitrarily long raster output.

## 9. Storage pressure and multipart fallback

Before every batch:

- inspect storage quota/usage;
- reserve a safe output margin;
- estimate batch capture and writer growth;
- shrink the batch when necessary.

If safe progress is impossible:

1. pause cleanly at the last verified page;
2. offer lower raster quality where appropriate;
3. resume after space is available; or
4. emit page-aligned multipart PDFs such as `part-001-pages-0001-0200.pdf`.

Multipart is a fallback, not the default. It may never split a logical page.

## 10. Strict completion verification

A viewer-capture job may become `completed` only if all applicable conditions are true:

- source identity still matches;
- discovery has a proven terminal condition;
- expected page count is known or stable-end discovery is proven;
- every page index in the sequence exists exactly once;
- every required page is `verified` or `written`;
- output writer reports the same page count;
- output page dimensions/orientation correspond to the page manifest;
- final PDF structural validation succeeds;
- no unresolved partial/batch/storage warning exists.

Conceptually:

```text
discovered == expected
captured   == expected
verified   == expected
output     == expected
AND sequence has no gaps/duplicates
AND source identity is unchanged
```

Only then may the popup display 100% / completed.

## 11. Recovery model

Recovery boundaries are page-based, not tile-based.

Required restart tests:

- service worker dies during page discovery;
- service worker dies after page capture but before manifest commit;
- service worker dies between batches;
- offscreen document dies while encoding a page;
- offscreen document dies while streaming PDF output;
- browser is closed/reopened with a resumable local job;
- source tab reloads or document identity changes;
- target viewer reuses/recycles page DOM nodes.

On valid recovery WebCap resumes at `lastVerifiedPage + 1` or the last durable writer checkpoint. Invalid identity recovery must offer restart/discard/keep verified partial output rather than joining mismatched documents.

## 12. Viewer compatibility / difficult-case matrix

Every release candidate must include fixtures or manual evidence for:

- direct `.pdf` URL;
- PDF detected only by Content-Type;
- authenticated PDF with cookies;
- 401/403 source but visible unlocked viewer;
- password-protected PDF already unlocked in the viewer;
- `blob:` PDF;
- `file://` PDF;
- `<iframe>`, `<embed>`, `<object>`;
- same-origin and cross-origin embedding;
- PDF.js viewer;
- virtualized viewer that keeps only 3–5 pages in DOM;
- canvas-only page renderer;
- open shadow DOM;
- long 126-page reference case;
- synthetic 500-page and 2,000-page documents;
- mixed portrait/landscape pages;
- mixed page sizes;
- rotated pages;
- blank pages;
- intentionally duplicate-looking adjacent pages;
- one page larger than the viewport in both axes;
- lazy page rendering and temporary placeholders;
- viewer toolbar/sticky overlays;
- DPR 1 / 1.5 / 2 and release zoom matrix;
- user scroll/input interference;
- transient layout-height drift;
- storage pressure near quota;
- capture cancellation, stop/keep, restart and resume.

## 13. UX

Add a dedicated user-facing PDF path without exposing implementation details.

Progress example:

```text
Đang xử lý PDF
Trang 71 / 126
Đang chụp đợt 5 • 56%
```

Optional secondary technical detail can show current stage:

- Đang tìm nguồn PDF gốc
- Đang nhận diện trang
- Đang chụp trang 71
- Đang ghi PDF
- Đang xác minh 126 trang

Result explains the selected strategy:

- `PDF gốc — giữ nguyên chất lượng`
- `Bản hiển thị — 126/126 trang đã xác minh`
- `PDF nhiều phần — giới hạn lưu trữ cục bộ`

Diagnostics remain allowlisted and content-free. Add only bounded fields such as source-strategy bucket, viewer-adapter bucket, discovered/captured/verified/output page counts, batch number, storage-pressure bucket, and error code.

## 14. Sessions

### S28 — PDF orchestration and contracts

Deliver:

- `PdfCaptureOrchestrator`;
- versioned `PdfDocumentManifest`;
- strategy negotiation contract;
- page-first progress contract;
- dedicated PDF state machine;
- generic scroll capture no longer owns PDF completion semantics.

Exit:

- no path can mark a PDF job complete from tile progress alone;
- existing S27 behavior remains green.

### S29 — Source Acquisition V2

Deliver:

- streamed source fetch to disk-backed spool;
- iframe/embed/object/blob/source discovery;
- authenticated source handling;
- optional active-tab CDP PDF response recovery using existing permission;
- large original PDFs no longer require a whole-file RAM buffer;
- encrypted original can still be saved even if geometry inspection is unavailable.

Exit:

- original source is preserved byte-for-byte whenever safely available;
- viewer fallback is automatic when source acquisition cannot be completed.

### S30 — Viewer Intelligence and incremental page discovery

Deliver:

- `PdfViewerAdapter` interface;
- PDF.js, generic semantic, shadow-root and virtualized adapters;
- incremental discovery manifest;
- visual page-boundary fallback with confidence scoring;
- mixed-size/orientation discovery;
- terminal-page proof without requiring all page DOM nodes simultaneously.

Exit:

- virtualized 500-page fixture discovers all logical pages without global projection assumptions.

### S31 — Page-native capture and adaptive batch controller

Deliver:

- `PageNativeCaptureEngine`;
- page-local tiling;
- adaptive page batch sizing;
- page readiness/stability detector;
- page-level verification and memory release;
- no global PDF tile cap in normal operation.

Exit:

- synthetic 2,000-page job can advance through batches with bounded current-page memory;
- stop/keep ends on full page boundary.

### S32 — Disk spool and streaming PDF writer

Deliver:

- OPFS spool store + safe fallback;
- sequential raster PDF writer;
- per-page orientation/size;
- writer checkpoints;
- structural validation;
- download from disk-backed final artifact.

Exit:

- output memory is bounded independently of document length;
- 126/500/2,000-page outputs have exact source page counts.

### S33 — Recovery, quota and multipart resilience

Deliver:

- restart recovery at every capture/output stage;
- storage quota/backpressure controller;
- automatic batch shrink;
- resumable paused jobs;
- page-aligned multipart fallback;
- cleanup/expiry for OPFS + IndexedDB ownership.

Exit:

- forced worker/offscreen crashes do not duplicate or lose verified pages;
- quota pressure never produces false completion.

### S34 — Difficult viewer compatibility and adversarial hardening

Deliver:

- compatibility adapters/heuristics for blob, embed, canvas-only, protected/unlocked, auth, lazy and recycled viewers;
- user-input interference handling;
- blank/duplicate-looking page correctness;
- visual discovery confidence negative tests;
- long-running soak tests.

Exit:

- compatibility matrix has no accepted P0/P1 correctness defect.

### S35 — Dedicated PDF UX, verification gate and release candidate

Deliver:

- dedicated PDF entry/auto-suggestion in popup;
- page-first progress and resume UI;
- strategy/result explanation;
- strict completion verifier surfaced in diagnostics;
- migration/backward compatibility;
- docs/manual QA;
- reproducible package and release matrix.

Exit:

- 100% means verified source-page completion, never tile-plan completion;
- full CI, packaged lifecycle and long-PDF release matrix pass.

## 15. Acceptance criteria AC-41–AC-60

- **AC-41** PDF uses a dedicated orchestrator and page-oriented state model.
- **AC-42** Original PDF is byte-preserved when safely accessible.
- **AC-43** Large original PDF source can stream without whole-file RAM buffering.
- **AC-44** PDF viewer capture has no normal document-wide tile-count completion limit.
- **AC-45** Virtualized/recycled viewers can be discovered incrementally.
- **AC-46** One source page produces exactly one output page.
- **AC-47** Mixed page size/orientation is preserved per page.
- **AC-48** One giant page can be tiled internally without full-document canvas allocation.
- **AC-49** Decoded/assembled raster memory is bounded by current page/batch, not document length.
- **AC-50** Storage pressure shrinks/pauses work without corrupting progress.
- **AC-51** Service-worker restart resumes without recapturing verified pages.
- **AC-52** Offscreen/output restart resumes from a durable writer checkpoint.
- **AC-53** Auth/encrypted/unavailable source falls back to viewer capture when visible content is capturable.
- **AC-54** Blank pages and duplicate-looking adjacent pages are retained correctly.
- **AC-55** Viewer chrome/gutters/gaps are excluded from logical output pages.
- **AC-56** Partial/stop output ends at complete source-page boundaries.
- **AC-57** Multipart fallback, when required, splits only between source pages.
- **AC-58** `completed`/100% requires strict discovered/captured/verified/output agreement.
- **AC-59** Diagnostics expose only bounded content-free PDF progress/strategy metadata.
- **AC-60** No new required permission/backend/telemetry/cloud dependency is introduced.

## 16. Validation gates for every session

Every implementation PR must run, at minimum:

- Prettier;
- ESLint;
- strict TypeScript;
- privacy/dependency/release/security audits;
- focused unit tests for new contracts/state/recovery;
- existing full unit suite;
- PDF performance benchmarks;
- production Manifest V3 build;
- reproducible ZIP check;
- existing Playwright E2E;
- new PDF-specific Chromium E2E affected by that session;
- packaged lifecycle where storage/migration/output changes.

S35 adds long-PDF soak runs and the complete compatibility matrix.

## 17. Explicit non-goals

- no OCR as a primary page detector;
- no cloud conversion service;
- no upload of captured PDF data;
- no claim of mathematical infinity/unlimited storage;
- no bypass of browser permissions/authentication controls;
- no silent loss of pages to satisfy a resource budget;
- no automatic page break based solely on A4/Letter height when logical source pages are known.

## 18. Definition of done

PDF Engine V2 is complete only when WebCap can demonstrate all of the following in browser tests or controlled fixtures:

1. a 126-page PDF produces exactly 126 verified output pages;
2. the same engine continues beyond the old 256/4,096 tile architecture through page batches rather than a whole-document tile plan;
3. a virtualized viewer with only a few live DOM pages is captured end-to-end;
4. mixed portrait/landscape and mixed-size pages remain one-to-one;
5. service-worker and offscreen restarts resume without page loss/duplication;
6. a storage-pressure case pauses or emits page-aligned multipart output instead of lying about completion;
7. original-source mode preserves bytes when available;
8. viewer-capture mode uses bounded page-at-a-time memory;
9. popup reports page progress and only reaches 100% after strict verification;
10. existing non-PDF capture modes remain regression-clean.
