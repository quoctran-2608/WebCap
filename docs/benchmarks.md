# WebCap PDF export benchmarks

This document records the repeatable S15 benchmark and integrity procedure for the local page-at-a-time PDF pipeline.

## Goals

The benchmark must demonstrate that WebCap can export long captures without creating a logical full-page canvas, without decoding multiple source tiles concurrently, and without persisting an output that fails PDF integrity checks.

The required reference scenarios are:

| Scenario      |  CSS dimensions | Purpose                                  |
| ------------- | --------------: | ---------------------------------------- |
| Standard 10k  |  1,440 × 10,000 | Common long landing page                 |
| Standard 30k  |  1,440 × 30,000 | Large article or report                  |
| Standard 100k | 1,440 × 100,000 | MVP long-page target                     |
| Wide 30k      |  4,096 × 30,000 | Wide table and horizontal-content stress |

## Commands

```bash
pnpm install --frozen-lockfile
pnpm benchmark:pdf
```

The benchmark prints one JSON line per scenario with the prefix field:

```json
{ "type": "webcap-pdf-benchmark" }
```

This makes the measurements easy to extract from GitHub Actions logs without parsing human-formatted test output.

## What the deterministic benchmark exercises

`tests/performance/pdf-export-benchmark.test.ts` runs the production layout, page slicing, tile-intersection, memory-guard, `pdf-lib`, integrity, progress, diagnostics, and artifact-persistence paths. It uses tiny stored tile Blobs and a lightweight page-canvas adapter so 100k and wide scenarios remain deterministic on shared CI runners.

The adapter reports the same decoded dimensions as the logical tiles and emits a valid one-pixel JPEG for every output page. It intentionally does **not** claim to measure real rasterization or JPEG encoding time. Real `OffscreenCanvas`, IndexedDB, extension messaging, page capture, PDF signature, and persisted-artifact behavior remain covered by Playwright extension E2E.

## Recorded fields

Each scenario records:

- CSS width and height;
- source tile count and stored source bytes;
- output page count and PDF artifact bytes;
- elapsed exporter duration;
- maximum simultaneously decoded tiles;
- maximum page-canvas pixel area;
- estimated peak working set and guard threshold;
- best-effort peak JavaScript heap when the runtime exposes it.

Heap values are evidence, not a cross-device guarantee. Chromium and Node may expose different heap accounting, so the deterministic working-set estimate is the authoritative guard input.

## Safety invariants

A benchmark passes only when all of the following remain true:

1. `maxDecodedTiles` is exactly one.
2. The maximum page canvas is smaller than the logical full-page pixel area.
3. The estimated working set does not exceed the active memory threshold.
4. The produced artifact is non-empty and reloads through `pdf-lib`.
5. Page count and page dimensions match the planned document.
6. The PDF has image-backed, non-empty streams.
7. Source tile records remain available after a guard or export failure.

## Memory guard

The guard estimates the live working set as:

```text
page RGBA + largest decoded tile RGBA + estimated encoded page + fixed exporter overhead
```

It also applies independent limits for total rendered pixels, tile count, and stored tile bytes. The runtime threshold is the smaller of the absolute exporter cap and 60% of the available heap limit.

An unsafe export fails before the PDF document or page canvas is allocated with `E_MEMORY_GUARD`. The user can then:

- lower JPEG quality;
- switch from fit-width to A4 or Letter multi-page output;
- remove pages and export the selection in smaller batches.

The original source tiles are not deleted, so retry does not recapture the page.

## Integrity validation

After `pdf-lib` saves the document and before the artifact is persisted, WebCap checks:

- `%PDF-` signature;
- non-zero byte length;
- loadability through `pdf-lib`;
- exact page count;
- page dimensions within 0.5 PDF points;
- at least one image object and non-empty streams.

A single image object may be reused by multiple PDF pages, so image-object count is not incorrectly required to equal page count. A failed check returns retryable `E_EXPORT_FAILED` with cause `PdfIntegrityCheckFailed` and no output artifact is stored.

## Reference decision

S15 retains pinned local `pdf-lib` 1.17.1. The page-at-a-time design keeps the largest live canvas bounded by one output page and keeps decoded-tile concurrency at one, so there is no benchmark evidence requiring a library or architecture change. An ADR is required only if future real-browser benchmarks invalidate these invariants.

## Latest validated run

The final S15 completion update must add the clean GitHub Actions run ID, environment, test counts, and measured JSON output here. Measurements must never be copied from a failed or partially skipped run.
