# S30 — Viewer Intelligence V2

S30 makes browser PDF discovery incremental and evidence-driven before the existing page-aware capture pipeline begins.

## Scope

This milestone adds a dedicated `PdfViewerAdapter` model and a pre-capture viewer discovery pass that can observe logical pages across many scroll positions while the viewer virtualizes or recycles DOM nodes.

Supported discovery buckets:

- PDF.js page containers and `data-page-number` semantics;
- generic numbered/semantic page containers;
- open-shadow-root page trees, including page trees owned directly by the selected shadow host;
- virtualized viewers where only a small moving window of pages exists in the DOM;
- canvas-only visual fallback when independent PDF context or declared page-count evidence exists.

S30 does not implement page-native raster capture, adaptive page batches, OPFS raster-page spooling, streaming PDF writing, quota pause/resume or multipart output. Those remain S31–S33.

## Runtime flow

```text
scroll-area initial probe
        ↓
PDF/page evidence gate
        ↓
typed PDF_VIEWER_DISCOVERY request
        ↓
content runtime resolves its owned opaque target
        ↓
scroll viewer incrementally
        ↓
collect semantic / canvas page candidates
        ↓
return metadata-only discovery snapshot
        ↓
background verifies identity + completion evidence
        ↓
strict DocumentPageMap
        ↓
restore viewer scroll position
        ↓
expand capture extent from verified pages if lazy rendering grew the viewer
        ↓
existing S27 page-aware capture/export
```

The selected DOM node never crosses the runtime boundary. The content runtime that already owns the opaque element target performs the scan, while background receives only typed metadata and applies completion verification. This avoids relying on a separately executed isolated-world function to recover private content-runtime state.

The discovery pass does not capture screenshots and does not allocate a full-document canvas. It only records bounded page geometry metadata. Indexed page observations are collapsed by logical page identity as discovery proceeds, and repeated unindexed geometry is retained only in a small bounded observation set. Ordinary scroll containers without page evidence or a PDF/document/viewer descriptor skip this pass entirely.

Intermediate scroll positions use a short bounded settle window after animation frames, while terminal observations retain the longer requested settle window. This keeps very large virtualized documents responsive without weakening the stable-end proof used for completion.

## Completion rules

A page map is complete only when one of these proof paths succeeds.

### Declared-page proof

- the viewer exposes a positive declared page count;
- discovery reaches the stable start and stable end of the viewer;
- every page index from `0..N-1` has been observed at least once;
- duplicate observations are collapsed by stable page index;
- the highest-confidence geometry for each logical page is retained.

This allows a 500-page document to complete even when only a small moving page window exists at a time.

### Geometry/visual proof

Used when a stable page index is unavailable:

- discovery reaches start and stable end;
- page candidates have sufficient confidence;
- repeated/recycled geometry is deduplicated;
- the first and last page cover the document edges within tolerance;
- the ordered sequence has no implausibly large internal gap;
- if a declared page count exists, the geometry sequence must agree with it.

Canvas candidates require independent PDF context or declared page-count evidence before they are considered. Canvas-only completion additionally requires repeated stable geometry across distinct observations and more than one page surface in at least one observation. A single viewport-sized canvas that is merely recycled while scrolling therefore cannot manufacture a fake multipage `DocumentPageMap`.

## Projection boundary

The legacy S27 `projected` page map remains in the domain schema for compatibility, but S30 no longer accepts it as final viewer-completion evidence when incremental discovery is responsible for the target.

Uniform rhythm can remain a diagnostic/fallback hint, but it cannot by itself make a PDF job page-complete.

## Mixed page sizes and orientation

Every accepted page keeps its independently observed `sourceRectCss`. No median width/height is substituted for a declared page sequence, so mixed portrait/landscape and mixed-size pages survive discovery unchanged.

## Lazy viewer growth and capture metrics

A viewer may increase `scrollHeight` while discovery activates lazy rendering or replaces placeholders. The original measurement probe therefore cannot always remain the source of truth for capture planning.

After a complete page map is proven, the scroll-area adapter expands the planned width/height to at least the verified page-map extent. Height growth is accepted as normal PDF virtualization behavior; newly discovered width growth beyond tolerance still sets the existing layout-change safety signal instead of silently weakening width-drift protection.

## Restoration and safety

- discovery preserves and restores the selected container's original `scrollLeft` and `scrollTop`;
- discovery uses a typed background ↔ content contract and metadata-only response;
- the content runtime resolves only the exact stored `jobId` + `selectionId` target and rejects stale/disconnected replacements;
- discovery is gated to the initial measurement probe and only for targets with PDF/page evidence;
- camelCase and tokenized viewer descriptors such as `pdfViewer`, `pdf-viewer` and `documentViewer` are recognized;
- no new Chrome permission is added;
- no backend, telemetry, remote code or page-content upload is introduced;
- discovery returns no complete map when terminal proof, stable canvas evidence, declared-count agreement or page continuity is missing;
- the existing S28 completion verifier remains authoritative after capture/output.

## Regression coverage

S30 adds deterministic tests for:

- a virtualized 500-page document discovered from sequential observations rather than simultaneous DOM nodes;
- mixed portrait/landscape page geometry;
- missing declared page identity preventing completion;
- canvas-only completion requiring stable terminal and repeated-geometry proof;
- rejection of a single recycled viewport canvas as fake multipage evidence;
- rejection of canvas geometry that conflicts with a declared page count;
- recycled geometry deduplication without collapsing adjacent logical pages;
- adapter integration only on the initial measurement probe;
- lazy viewer height growth expanding capture planning from the verified page-map extent;
- ordinary scroll containers skipping the expensive discovery pass;
- rejection of the legacy projection-only page map when incremental discovery has no completion proof.

The browser regression uses the real extension content runtime and requires all 500 logical page identities to be observed while the fixture keeps only a small moving page window in the DOM.

## Exit target

S30 is complete when the full repository validation remains green and the virtualized 500-page discovery regression passes without relying on global uniform-page projection.
