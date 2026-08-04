import { readFile, writeFile } from "node:fs/promises";

async function replaceRequired(path, replacements) {
  let content = await readFile(path, "utf8");
  for (const [from, to] of replacements) {
    if (!content.includes(from)) {
      throw new Error(`Missing required text in ${path}: ${from.slice(0, 100)}`);
    }
    content = content.replace(from, to);
  }
  await writeFile(path, content);
}

await replaceRequired("PLAN.md", [
  ["current_session: S15", "current_session: S16"],
  [
    "| S15 | M4 | PDF benchmarks, integrity và memory guards | S14 | 18k–26k | NEXT |",
    "| S15 | M4 | PDF benchmarks, integrity và memory guards | S14 | 18k–26k | DONE |",
  ],
  [
    "| S16 | M5 | Scrollable-container detection và capture | S15 | 22k–30k | READY |",
    "| S16 | M5 | Scrollable-container detection và capture | S15 | 22k–30k | NEXT |",
  ],
  [
    "| S15 | NEXT | — | — | — | Sẵn sàng benchmark PDF 10k/30k/100k, kiểm tra integrity và memory guard. |\n| S16 | READY | — | — | — | — |",
    "| S15 | DONE | 2026-08-04 | PR #19 / CI 30871783639 | format, lint, typecheck, 239 unit, 4 PDF benchmarks, build, 20 Playwright E2E | Guard trước allocation, PDF integrity trước persistence, diagnostics heap best-effort và reference 10k/30k/100k/wide đã xác thực page-at-a-time với decoded concurrency bằng 1; source tiles được giữ để retry. |\n| S16 | NEXT | — | — | — | Sẵn sàng detection/revalidation, 2D internal-scroll capture và exact restore cho scrollable container. |",
  ],
  [
    "Session kế tiếp là **S15 — PDF benchmarks, integrity và memory guards**.",
    "Session kế tiếp là **S16 — Scrollable-container detection và capture**.",
  ],
  [
    "1. Đọc `PLAN.md` phần S15.\n2. Đọc SPEC §21–22, §27.5, TV-01/TV-02 và NFR PDF liên quan trong PRD.\n3. Kiểm tra repo/branch và kết quả CI S14.\n4. Chỉ triển khai S15.\n5. Kết thúc với benchmark repeatable 10k/30k/100k, PDF integrity checker, decoded-concurrency/heap evidence, memory guard có phương án thay thế và `docs/benchmarks.md`.",
    "1. Đọc `PLAN.md` phần S16.\n2. Đọc SPEC §19–21, TV-06 và acceptance criteria scroll-area trong PRD.\n3. Kiểm tra repo/branch và kết quả CI S15.\n4. Chỉ triển khai S16.\n5. Kết thúc với scrollable-container candidate detection, stable target revalidation, 2D internal-scroll tile capture, sticky-child policy, exact restore và E2E success/cancel/stale/wide-table.",
  ],
]);

await replaceRequired("README.md", [
  [
    "**S14 — PDF editor, options, and non-destructive retry are implemented.** A ready tiled capture can now open a dedicated React editor routed by job ID. The editor restores a persistent edit manifest after reload, lazy-loads page thumbnails from local source tiles, supports logical page removal and keyboard-accessible reordering, and exposes A4, Letter, fit-width, portrait/landscape, margin, and JPEG-quality settings with an explicitly approximate size estimate. Export uses the S13 page-at-a-time pipeline, reports per-page progress, supports cooperative cancellation and retry without recapturing, and downloads the completed local PDF artifact. Source tiles remain immutable and reusable; thumbnails and PDF bytes stay as IndexedDB Blob values rather than crossing runtime messages. S15 remains responsible for 10k/30k/100k PDF benchmarks, integrity checks, and memory guardrails.",
    "**S15 — PDF benchmarks, integrity validation, and memory guards are implemented.** The page-at-a-time exporter now estimates the live working set before allocating a PDF document or page canvas, blocks unsafe jobs with retryable `E_MEMORY_GUARD`, and offers lower-quality, A4/Letter multi-page, or smaller-batch alternatives without deleting source tiles. Every completed PDF is checked before persistence for signature, loadability, page count, page dimensions, image backing, and non-empty streams. A dedicated repeatable benchmark command covers 1,440 × 10k, 30k, and 100k CSS-pixel pages plus a 4,096 × 30k wide scenario; the clean reference run kept decoded-tile concurrency at one and all estimates below the active heap threshold. S16 is next: full capture of scrollable containers.",
  ],
  [
    "pnpm test:unit     # Run the unit-test suite once.\npnpm test:smoke",
    "pnpm test:unit     # Run the unit-test suite once.\npnpm benchmark:pdf    # Run repeatable long-page PDF reference benchmarks.\npnpm test:smoke",
  ],
  [
    "tests/unit/             Fast deterministic contract, engine, coordinator, and router tests.\ntests/e2e/",
    "tests/unit/             Fast deterministic contract, engine, coordinator, and router tests.\ntests/performance/        Repeatable PDF benchmark scenarios and metric output.\ntests/e2e/",
  ],
  [
    "- [Privacy baseline](./docs/privacy.md)",
    "- [PDF benchmark and integrity reference](./docs/benchmarks.md)\n- [Privacy baseline](./docs/privacy.md)",
  ],
]);

const changelogPath = "CHANGELOG.md";
let changelog = await readFile(changelogPath, "utf8");
const changelogMarker = "### Added\n\n";
const changelogEntry = `- Pre-allocation PDF memory guard using total pixels, tile count, stored tile bytes, one-page RGBA, one decoded tile, encoded-page estimate, fixed overhead, and best-effort runtime heap limits.\n- Retryable \`E_MEMORY_GUARD\` guidance for lower JPEG quality, A4/Letter multi-page output, or smaller page batches while preserving every source tile.\n- PDF integrity validation before artifact persistence for signature, non-empty bytes, pdf-lib loadability, exact page count, page dimensions within 0.5 points, image backing, and non-empty streams.\n- Export diagnostics for duration, artifact bytes, maximum decoded concurrency, maximum canvas area, working-set estimate, guard threshold, integrity counts, and best-effort heap peak.\n- Dedicated \`pnpm benchmark:pdf\` reference suite covering 1,440 × 10k/30k/100k and 4,096 × 30k wide scenarios with machine-readable JSON metrics.\n- The S15 clean reference gate passes 239 unit tests across 66 files, four PDF benchmark scenarios, the Manifest V3 build, and 20 Playwright E2E cases.\n`;
if (!changelog.includes("Pre-allocation PDF memory guard using total pixels")) {
  if (!changelog.includes(changelogMarker)) throw new Error("CHANGELOG Added marker missing.");
  changelog = changelog.replace(changelogMarker, `${changelogMarker}${changelogEntry}`);
  await writeFile(changelogPath, changelog);
}

const manualPath = "docs/manual-testing.md";
let manual = await readFile(manualPath, "utf8");
if (!manual.includes("## S15 PDF benchmark, integrity, and memory-guard validation")) {
  manual += `\n\n## S15 PDF benchmark, integrity, and memory-guard validation\n\n1. Run \`pnpm install --frozen-lockfile\`, then \`pnpm benchmark:pdf\`. Confirm four machine-readable \`webcap-pdf-benchmark\` JSON lines are printed for 1,440 × 10k, 30k, 100k and 4,096 × 30k wide scenarios.\n2. Confirm every scenario creates a non-empty PDF, planned page count matches the persisted artifact, \`maxDecodedTiles\` is one, and the largest page canvas remains smaller than the logical full-page pixel area.\n3. Inspect the 100k reference: it should plan 13 stored tiles and 48 PDF pages while keeping the deterministic working-set estimate below the active guard threshold. Treat elapsed times as CI reference measurements, not real browser raster/JPEG latency.\n4. Export a normal ready job through the extension. Before the first canvas allocation, verify the guard accounts for total pixels, tile count, stored source bytes, page RGBA, largest decoded tile, estimated JPEG bytes, fixed overhead, and best-effort heap limit.\n5. Force an unsafe fit-width/wide-page estimate. Confirm export stops before creating a PDF document or canvas with retryable \`E_MEMORY_GUARD\` and offers lower quality, A4/Letter multi-page output, or removing/exporting smaller page batches.\n6. Confirm the guard failure stores no output artifact and leaves the source tile count and Blob bytes unchanged so retry does not recapture.\n7. Corrupt the generated PDF signature or produce a blank/image-less document in a test adapter. Confirm the integrity check returns retryable \`E_EXPORT_FAILED\` with cause \`PdfIntegrityCheckFailed\`, persists no corrupt artifact, and preserves source tiles.\n8. For a valid PDF, verify \`%PDF-\`, non-zero bytes, pdf-lib loadability, exact page count, dimensions within 0.5 PDF points, at least one image object, and non-empty streams before artifact persistence.\n9. Inspect diagnostics: duration, artifact bytes, decoded count/concurrency, maximum page-canvas area, released canvas count, working-set estimate, threshold, integrity counts, and heap peak when the runtime exposes it. No diagnostic may contain page content or image bytes.\n10. Run \`pnpm test:unit\`, \`pnpm benchmark:pdf\`, and \`pnpm test:e2e\`. The S15 clean reference gate contains 239 unit tests across 66 files, four benchmark cases, and 20 Playwright cases.\n`;
  await writeFile(manualPath, manual);
}

await replaceRequired("docs/benchmarks.md", [
  [
    "The final S15 completion update must add the clean GitHub Actions run ID, environment, test counts, and measured JSON output here. Measurements must never be copied from a failed or partially skipped run.",
    `Clean GitHub Actions run \`30871783639\` completed on 2026-08-04 using Ubuntu 24.04, Node.js 22.22.0, pnpm 11.15.1, and the pinned local \`pdf-lib\` 1.17.1. The run passed format, lint, strict typecheck, 239 unit tests across 66 files, four dedicated PDF benchmark cases, the Manifest V3 build, and 20 Playwright E2E cases.\n\n| Scenario | Tiles | Pages | Duration | PDF bytes | Max decoded | Max canvas pixels | Working set | Threshold | Peak heap |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n| 1,440 × 10k | 2 | 5 | 26.04 ms | 5,070 | 1 | 3,003,840 | 95,884,512 B | 483,183,820 B | 18,958,192 B |\n| 1,440 × 30k | 4 | 15 | 29.11 ms | 13,888 | 1 | 3,003,840 | 95,884,512 B | 483,183,820 B | 21,339,352 B |\n| 1,440 × 100k | 13 | 48 | 50.23 ms | 43,332 | 1 | 3,003,840 | 95,884,512 B | 483,183,820 B | 23,770,784 B |\n| 4,096 × 30k wide | 4 | 6 | 7.03 ms | 5,949 | 1 | 24,301,568 | 288,793,969 B | 483,183,820 B | 22,393,096 B |\n\nThese durations measure the deterministic CI reference adapter and production planning/PDF/integrity code. They do not measure real browser screenshot capture, raster drawing, or JPEG encoding latency. The load-bearing results are the bounded page canvas, decoded concurrency of one, valid persisted PDFs, and working-set estimates below the active threshold.`,
  ],
]);
