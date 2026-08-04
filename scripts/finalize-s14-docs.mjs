import { readFile, writeFile } from "node:fs/promises";

async function replaceRequired(path, replacements) {
  let content = await readFile(path, "utf8");
  for (const [from, to] of replacements) {
    if (!content.includes(from)) {
      throw new Error(`Missing required text in ${path}: ${from.slice(0, 80)}`);
    }
    content = content.replace(from, to);
  }
  await writeFile(path, content);
}

await replaceRequired("PLAN.md", [
  ["current_session: S14", "current_session: S15"],
  [
    "| S14 | M4 | Editor, PDF options và export retry | S13 | 20k–28k | NEXT |",
    "| S14 | M4 | Editor, PDF options và export retry | S13 | 20k–28k | DONE |",
  ],
  [
    "| S15 | M4 | PDF benchmarks, integrity và memory guards | S14 | 18k–26k | READY |",
    "| S15 | M4 | PDF benchmarks, integrity và memory guards | S14 | 18k–26k | NEXT |",
  ],
  [
    "| S14 | NEXT | — | — | — | Sẵn sàng triển khai editor, PDF options và export retry không recapture. |\n| S15 | READY | — | — | — | — |",
    "| S14 | DONE | 2026-08-04 | PR #18 | format, lint, typecheck, 230 unit, build, 20 Playwright E2E | Editor theo job ID, manifest non-destructive, thumbnail bounded/lazy, remove/reorder, PDF options, progress/cancel/retry và download không recapture đã được xác thực. |\n| S15 | NEXT | — | — | — | Sẵn sàng benchmark PDF 10k/30k/100k, kiểm tra integrity và memory guard. |",
  ],
  [
    "Session kế tiếp là **S14 — Editor, PDF options và export retry**.",
    "Session kế tiếp là **S15 — PDF benchmarks, integrity và memory guards**.",
  ],
  [
    "1. Đọc `PLAN.md` phần S14.\n2. Đọc SPEC UI M4, §22–23 và job artifact behavior.\n3. Kiểm tra repo/branch và kết quả CI S13.\n4. Chỉ triển khai S14.\n5. Kết thúc với editor theo job ID, lazy page thumbnails, remove/reorder manifest, A4/Letter/fit-width options, progress/cancel/retry, reload persistence và export lại không recapture hoặc mutate source tiles.",
    "1. Đọc `PLAN.md` phần S15.\n2. Đọc SPEC §21–22, §27.5, TV-01/TV-02 và NFR PDF liên quan trong PRD.\n3. Kiểm tra repo/branch và kết quả CI S14.\n4. Chỉ triển khai S15.\n5. Kết thúc với benchmark repeatable 10k/30k/100k, PDF integrity checker, decoded-concurrency/heap evidence, memory guard có phương án thay thế và `docs/benchmarks.md`.",
  ],
]);

const changelogPath = "CHANGELOG.md";
let changelog = await readFile(changelogPath, "utf8");
const changelogMarker = "### Added\n\n";
const changelogEntry = `- Dedicated React PDF editor routed by persistent job ID, with reload-safe non-destructive edit manifests that never reorder or delete source tiles.\n- Bounded lazy page thumbnails rendered from local tile Blobs, keyboard-accessible logical page reordering/removal, and cache identities tied to manifest revision.\n- A4, Letter, fit-width, portrait/landscape, margin, and JPEG-quality controls with explicitly approximate size estimates.\n- Edited-page PDF export through the page-at-a-time S13 pipeline, including per-page progress, cooperative cancellation, retry, local artifact download, and no recapture.\n- Typed editor/offscreen protocols, IndexedDB read/write race hardening, progress ACK isolation, and browser validation covering reload persistence, thumbnail bounds, immutable source tiles, PDF integrity, and download.\n- The S14 reference suite passes 230 unit tests across 64 files and 20 Playwright E2E cases.\n`;
if (!changelog.includes("Dedicated React PDF editor routed by persistent job ID")) {
  if (!changelog.includes(changelogMarker)) throw new Error("CHANGELOG Added marker missing.");
  changelog = changelog.replace(changelogMarker, `${changelogMarker}${changelogEntry}`);
  await writeFile(changelogPath, changelog);
}

const manualPath = "docs/manual-testing.md";
let manual = await readFile(manualPath, "utf8");
if (!manual.includes("## S14 PDF editor and non-destructive retry validation")) {
  manual += `\n\n## S14 PDF editor and non-destructive retry validation\n\n1. Build and load the extension, capture \`tests/fixtures/full-page-long.html\`, and wait until the full-page tile set is ready.\n2. Click **Mở trình biên tập PDF**. Confirm the dedicated editor URL contains the job ID and shows more than two logical pages.\n3. Wait for the first thumbnail. Its longest edge must be at most 320 pixels; thumbnails and PDF bytes remain Blob values in IndexedDB and never cross runtime messages.\n4. Change paper size to Letter, orientation to landscape, margin to 12 mm, and JPEG quality to 0.75. Apply settings and confirm the page list and approximate estimate are recalculated.\n5. Focus the first page card and press Alt+ArrowDown. Confirm the logical source order changes, then remove the last page. Source tile count and total source Blob bytes must remain unchanged.\n6. Reload the editor. Confirm page count, order, settings, and manifest revision are restored from \`chrome.storage.local\`.\n7. Create the PDF and observe monotonic per-page progress. Cancel during export and retry; the retry must reuse the same source tiles without invoking capture again.\n8. Download the completed artifact. Confirm the file begins with \`%PDF-\`, page count matches the edited manifest, page dimensions match the selected settings, and every page has a non-empty image stream.\n9. Inspect IndexedDB and session/local storage: binary source tiles, thumbnails, and PDF artifacts are local Blobs; persistent messages and edit manifests contain metadata only.\n10. Run \`pnpm test:unit\` and \`pnpm test:e2e\`. The S14 reference gate contains 230 unit tests and 20 Playwright cases, including the full reload–edit–export–download path plus all prior capture regressions.\n`;
  await writeFile(manualPath, manual);
}
