# S29 — PDF Source Acquisition V2

S29 upgrades original-PDF acquisition without changing WebCap's permission model.

## Runtime strategy

1. Discover source candidates from the active tab, Chromium PDF viewer metadata, and page-level `embed`, `object`, `iframe`, `source`, and PDF links.
2. Require the exact existing optional host/file permission before network access.
3. Fetch with browser credentials and stream `response.body` directly into an OPFS temporary file.
4. Compute SHA-256 and the `%PDF-` signature incrementally while chunks are written.
5. Reject cross-origin redirects unless that redirect origin is also permitted.
6. If direct fetch fails or returns 401/403, optionally use the existing debugger permission with `Network.loadNetworkResource` + `IO.read` to recover only the requested active-tab PDF source.
7. Persist the completed disk-backed Blob as the existing output artifact, then remove the temporary OPFS spool.
8. Inspect geometry only for small originals; a signature-valid encrypted or large PDF is preserved even when geometry inspection is unavailable.
9. If source acquisition cannot be completed safely, fall back to viewer capture instead of buffering the whole file or reporting false success.

## Correctness boundary

- Original bytes remain byte-identical.
- No normal whole-file 128 MiB RAM guard is used.
- No whole-file `Uint8Array` is assembled during streamed acquisition.
- OPFS/storage pressure causes a safe viewer fallback.
- No backend, telemetry, remote code, new required permission, or default host permission is introduced.

S30 remains responsible for virtualized/canvas viewer intelligence. S32 remains responsible for the general raster-page spool and streaming PDF writer.
