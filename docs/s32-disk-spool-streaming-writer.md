# S32 — Disk Spool and Streaming PDF Writer

## Goal

S32 removes document-length output memory growth from raster PDF export. The existing S31 page-native capture engine still owns logical-page discovery, page-local capture, and complete-page verification. S32 changes the output side: each rendered logical page is encoded independently, staged briefly in OPFS, streamed into a disk-backed PDF, checkpointed, then released before the next page advances.

The milestone implements the S32 roadmap boundary: OPFS spool storage with a safe pre-write fallback, a sequential raster PDF writer, per-page size/orientation, durable writer checkpoints, structural validation, and download from a disk-backed final artifact.

## Output pipeline

```text
verified capture tiles
  -> one logical page canvas
  -> one JPEG page raster
  -> temporary OPFS raster file
  -> SequentialRasterPdfWriter
  -> final OPFS PDF
  -> structural verification
  -> IndexedDB artifact metadata + OPFS reference
  -> object URL / download on demand
```

There is no full-document canvas and the normal streamed path never asks `pdf-lib` to assemble or save the complete raster document.

## OPFS ownership

`OpfsPdfOutputSpool` uses the extension origin's Origin Private File System under `webcap-pdf-output/`.

It provides two kinds of local files:

- a final `<artifact>.pdf` output written incrementally;
- a temporary `<artifact>.page-XXXXXX.jpg` for only the page currently being appended.

The temporary JPEG is deleted immediately after the writer checkpoint and progress acknowledgement for that logical page. The final PDF remains disk-backed and IndexedDB stores its bounded metadata plus `opfsReference` instead of duplicating the complete PDF Blob into IndexedDB.

If OPFS is unavailable before the streamed writer has written any output, S32 may fall back to the existing `PdfExporter`. A quota error is not silently converted to the memory-heavy fallback. Quota/backpressure policy belongs to S33.

## Sequential PDF writer

`SequentialRasterPdfWriter` emits PDF 1.7 objects directly into the OPFS writable stream.

For each logical page it writes:

1. a `/Page` object with that page's exact `MediaBox`;
2. a JPEG `/XObject` using `/DCTDecode` while streaming the JPEG Blob in chunks;
3. a short content stream that places the page image with the planned `imageRectPt`.

At finalization it writes the `/Pages` tree, catalog, classic xref table, trailer, `startxref`, and `%%EOF` marker. Only object offsets and small page metadata grow with document length; raster/PDF bytes do not accumulate in JavaScript heap.

The writer preserves mixed page sizes and portrait/landscape orientation because every logical page has its own `pageWidthPt`, `pageHeightPt`, and image rectangle.

## Durable writer checkpoints

After every page is durably appended, the offscreen exporter stores a checkpoint in the dedicated `webcap-pdf-writer-db` database:

- `jobId`;
- `outputArtifactId`;
- OPFS spool reference;
- `pagesWritten`;
- `totalPages`;
- current byte length;
- creation/update/expiry timestamps.

S32 establishes the durable boundary needed by recovery, but does not yet resume a crashed writer from that checkpoint. S33 owns crash recovery and resumable paused-job orchestration.

## Structural verification

The long-document streamed path does not load the finished PDF into `pdf-lib` merely to validate it. `streaming-pdf-integrity` checks bounded slices of the disk-backed Blob:

- `%PDF-1.7` header;
- `startxref` and terminal `%%EOF`;
- xref size and every object offset;
- trailer root;
- catalog -> pages root relationship;
- exact `/Count`;
- exact ordered `/Kids` page references.

The xref/trailer region is bounded metadata and is read independently of image payload length.

## Disk-backed artifact download

`ArtifactRecord` can now represent either a Blob-backed artifact or a disk-backed artifact with `opfsReference`.

`ObjectUrlRegistry` resolves the OPFS file only when preview/download needs an object URL. Runtime messages continue to carry `ArtifactMetadata` only; PDF bytes are never sent through Chrome runtime messaging.

Real-browser PDF E2E reads the final extension-origin OPFS file through the stored reference, verifies that IndexedDB does not duplicate the final Blob, checks the `%PDF-` signature and file size, and still parses page count/orientation for page-aware viewer output. Both ordinary full-page PDF export and page-aware scroll-viewer export exercise this disk-backed contract.

## Memory invariant

The streamed path owns at most:

- one logical page canvas;
- one decoded capture tile at a time;
- the current encoded page JPEG;
- bounded writer/xref metadata.

The final PDF grows on disk. Therefore output raster/PDF memory is bounded by the current page rather than document length.

The memory guard follows the same ownership boundary. It evaluates the maximum tile count and stored tile bytes intersecting any one selected logical page, not the aggregate tile count or byte size of the captured document. A document may therefore contain more than the legacy 4,096-tile threshold without being rejected merely because the PDF is long; a genuinely oversized single logical page can still be blocked by the page-local safety budget. Memory diagnostics report those maximum active-page values rather than document totals.

## S32 validation targets

S32 adds regressions for:

- loadable mixed portrait/landscape streamed output;
- exact source/output page counts for synthetic 126, 500, and 2,000-page documents;
- refusal to finalize a truncated page sequence;
- per-page durable checkpoint advancement;
- no final PDF Blob duplication in IndexedDB on the streamed path;
- deletion of temporary page raster files;
- a 4,097-tile captured document exporting a selected page without tripping the legacy document-wide tile-count guard;
- safe legacy fallback only when OPFS is unavailable before writing.

The existing S29 source passthrough, S30 viewer discovery, S31 page-native capture, PDF editor/export, generic capture modes, full extension E2E matrix, and packaged lifecycle remain release gates.

## Explicit S33 boundary

S32 intentionally does not implement:

- service-worker/offscreen/browser restart recovery;
- reopening and continuing a partially written PDF;
- storage-pressure batch shrink or pause/resume UX;
- page-aligned multipart fallback;
- full OPFS/IndexedDB ownership garbage collection and expiry cleanup.

Those behaviors require coordinated recovery and storage-pressure policy and remain S33 scope. No new required/default host permission, backend, telemetry, account, cloud service, or remote executable code is introduced by S32.
