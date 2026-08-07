# S27 — Dedicated page-aware PDF capture

## User-visible invariants

1. A detected source PDF page maps to exactly one output PDF page.
2. `maxTiles` is a capture batch size for a detected document, not proof that the document ended.
3. A job cannot complete a full dedicated PDF export unless its output page count equals the detected source page count.
4. Viewer background, inter-page gaps, and side gutters are excluded from logical page output.
5. Width drift, viewport drift, scroll snapping, stale targets, and pixel-scale changes remain hard safety failures.
6. When original PDF passthrough is available and permitted, it remains preferred over viewer recapture.

## Safety limits

Detected documents may plan beyond the normal 256-tile batch, up to a separate hard document cap. Tile blobs are persisted incrementally, and page export decodes only the tiles intersecting the current logical page.
