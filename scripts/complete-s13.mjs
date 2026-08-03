import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let content = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (!content.includes(before)) {
      throw new Error(`Missing S13 completion pattern in ${path}: ${before.slice(0, 180)}`);
    }
    content = content.replace(before, after);
  }
  await writeFile(path, content, "utf8");
}

await patch("README.md", [
  [
    `**S12 — Element capture selection is complete.** WebCap now exposes element mode with an isolated Shadow DOM selector, sanitized tag/id/class labels, live dimensions, click selection, parent/previous-child keyboard navigation, Enter/Escape, scrollable-candidate metadata, and recursive hit testing through open Shadow DOM. The persistent job stores only an opaque descriptor and CSS document rectangle; the actual DOM identity stays inside the content runtime and is revalidated after page preparation and immediately before every engine attempt. A removed or replaced target fails safely with retryable \`E_TARGET_STALE\` and a reselection flow instead of capturing another node. Normal, open-shadow, stale, keyboard-cancel, exact restoration, CDP tile capture, and all previous region/full-page/visible paths are covered by automation. PDF page slicing and page-at-a-time export are next in S13; full scrollable-element content remains reserved for S16.`,
    `**S13 — Paged PDF export foundation is complete.** WebCap can now convert a stored logical tile set into A4, Letter, or fit-width PDF pages using pure physical-unit conversion, continuous CSS page slicing, running fractional pixel ranges, and strict tile-to-page intersection coverage. The offscreen exporter allocates only one PDF-page-sized canvas, decodes one tile at a time, JPEG-encodes each page, embeds it with local \`pdf-lib\`, releases page resources, and persists the final \`application/pdf\` Blob with page count and export progress. Automated coverage reloads a real generated PDF, rejects gaps/overlaps, verifies exact final pixel coverage, preserves source tiles on failure, and completes a real 9,600 CSS-pixel browser export. PDF remains hidden in the popup until S14 adds the editor, options, retry, and download UX.`,
  ],
]);

await patch("CHANGELOG.md", [
  [
    `### Added\n\n`,
    `### Added\n\n- Page-size and unit-conversion primitives for A4, Letter, fit-width, portrait/landscape, margins, CSS pixels, millimeters, inches, and PDF points.\n- Continuous PDF source slicing with running fractional pixel residuals so final page coverage reaches the exact source pixel without accumulated seams.\n- Deterministic tile-to-page intersection planning that consumes overlap/output metadata and rejects missing or duplicated logical coverage.\n- Page-at-a-time offscreen PDF rendering with one page-sized \`OffscreenCanvas\`, sequential single-tile decoding, per-page JPEG encoding, local \`pdf-lib\` embedding, and explicit bitmap/canvas release.\n- Persistent \`PDF_EXPORT_START\` routing, monotonic page progress, output artifact IDs, \`application/pdf\` Blob storage, page-count metadata, retryable export failures, and source-tile preservation.\n- PDF contract, state-machine, service, router, real-document integrity, memory-lifecycle, and browser integration coverage; the S13 reference suite passes 215 unit tests and 19 Playwright cases.\n`,
  ],
]);

const manualPath = "docs/manual-testing.md";
let manual = await readFile(manualPath, "utf8");
manual += `\n\n## S13 page-at-a-time PDF export validation\n\n1. Build and load the extension, serve \`tests/fixtures/full-page-long.html\`, and create a ready full-page tile set. S13 intentionally does not expose a PDF button in the popup; the user-facing editor and options arrive in S14.\n2. From an extension context, send a typed \`PDF_EXPORT_START\` request for the ready job with A4 portrait, 8 mm margins, and a JPEG quality such as 0.82. The immediate response must contain the same job in \`exporting\` with page progress initialized at zero.\n3. Inspect the job while export runs. \`completedPages\` must increase monotonically and never exceed \`totalPages\`; reopening or polling the job must not transfer tile/image Blob bytes through runtime messages.\n4. When complete, confirm the job contains \`outputArtifactId\`, equal completed/total page counts, and state \`completed\`. The original source tile records must still exist for later S14 retry/re-export.\n5. Inspect the output artifact in IndexedDB: format \`pdf\`, MIME \`application/pdf\`, a non-empty Blob, a positive page count, and a filename ending in \`.pdf\`. The first five bytes should decode to \`%PDF-\`.\n6. Open the generated file in Chrome and another PDF reader. Confirm all pages load and the source proceeds continuously from top to bottom without a white gap or duplicated strip at page/tile boundaries.\n7. Repeat pure layout checks for A4, Letter, landscape, fit-width, fractional source heights, and DPR-derived non-integer pixel ranges. The final range must end exactly at the rounded source pixel height.\n8. Remove a stored source tile before export. WebCap must fail before page-canvas allocation with retryable \`E_STORAGE_READ\`; no partial output artifact may be persisted.\n9. Force JPEG/PDF encoding failure after export starts. The job must become retryable \`failed\` with \`E_EXPORT_FAILED\`, while the stored capture tiles remain intact.\n10. Run \`pnpm test:unit\` and \`pnpm test:e2e\`. The S13 reference suite contains 215 unit tests across 58 files and 19 Playwright cases, including a real 9,600 CSS-pixel tile-set-to-PDF browser export and all previous capture regressions.\n`;
await writeFile(manualPath, manual, "utf8");

await patch("PLAN.md", [
  [`current_session: S13`, `current_session: S14`],
  [
    `| S13 | M4 | PDF page slicing và page-at-a-time exporter | S12 | 20k–28k | NEXT |\n| S14 | M4 | Editor, PDF options và export retry | S13 | 20k–28k | READY |`,
    `| S13 | M4 | PDF page slicing và page-at-a-time exporter | S12 | 20k–28k | DONE |\n| S14 | M4 | Editor, PDF options và export retry | S13 | 20k–28k | NEXT |`,
  ],
  [
    `| S13 | NEXT | — | — | — | Sẵn sàng triển khai PDF page slicing và page-at-a-time exporter. |\n| S14 | READY | — | — | — | — |`,
    `| S13 | DONE | 2026-08-03 | PR #17 / a4b0aba / CI 30810848147 | format, lint, typecheck, 215 unit, build, 19 Playwright E2E | Unit conversion, continuous slicing, exact pixel residuals, tile intersections, one-page/one-decoded-tile lifecycle, pdf-lib artifact, persistent progress và real PDF browser smoke đã được xác thực. |\n| S14 | NEXT | — | — | — | Sẵn sàng triển khai editor, PDF options và export retry không recapture. |`,
  ],
  [
    `Session kế tiếp là **S13 — PDF page slicing và page-at-a-time exporter**.\n\nKhi được yêu cầu tiếp tục code, tôi phải:\n\n1. Đọc \`PLAN.md\` phần S13.\n2. Đọc SPEC §21–23, TV-02 và acceptance criteria PDF trong PRD.\n3. Kiểm tra repo/branch và kết quả CI S12.\n4. Chỉ triển khai S13.\n5. Kết thúc với unit conversion, pure page slicing, tile-to-page intersections, page-at-a-time offscreen canvas, PDF artifact persistence, export progress và integrity tests không tạo canvas toàn trang.`,
    `Session kế tiếp là **S14 — Editor, PDF options và export retry**.\n\nKhi được yêu cầu tiếp tục code, tôi phải:\n\n1. Đọc \`PLAN.md\` phần S14.\n2. Đọc SPEC UI M4, §22–23 và job artifact behavior.\n3. Kiểm tra repo/branch và kết quả CI S13.\n4. Chỉ triển khai S14.\n5. Kết thúc với editor theo job ID, lazy page thumbnails, remove/reorder manifest, A4/Letter/fit-width options, progress/cancel/retry, reload persistence và export lại không recapture hoặc mutate source tiles.`,
  ],
]);
