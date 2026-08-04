import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, oldText, newText) {
  const text = readFileSync(path, "utf8");
  if (!text.includes(oldText)) {
    throw new Error(`Expected text not found in ${path}: ${oldText.slice(0, 120)}`);
  }
  writeFileSync(path, text.replace(oldText, newText), "utf8");
}

replaceOnce(
  "README.md",
  "**S15 — PDF benchmarks, integrity validation, and memory guards are implemented.** The page-at-a-time exporter now estimates the live working set before allocating a PDF document or page canvas, blocks unsafe jobs with retryable `E_MEMORY_GUARD`, and offers lower-quality, A4/Letter multi-page, or smaller-batch alternatives without deleting source tiles. Every completed PDF is checked before persistence for signature, loadability, page count, page dimensions, image backing, and non-empty streams. A dedicated repeatable benchmark command covers 1,440 × 10k, 30k, and 100k CSS-pixel pages plus a 4,096 × 30k wide scenario; the clean reference run kept decoded-tile concurrency at one and all estimates below the active heap threshold. S16 is next: full capture of scrollable containers.",
  "**S16 — full scrollable-area capture is implemented.** WebCap can now select an overflow container and capture its complete internal `scrollWidth` × `scrollHeight` through a deterministic two-dimensional visible-tab crop grid. The content runtime keeps the selected DOM identity opaque, revalidates it before every internal scroll, crops each viewport screenshot to the container content box, suppresses local sticky descendants without mutating unrelated ancestors, and restores container/document scroll and styles on success, cancellation, stale-target failure, or capture error. Stored tiles carry explicit viewport-crop metadata so previews and PDF export consume only the intended container pixels. The clean reference gate passes 248 unit tests, four PDF benchmarks, and 23 Playwright E2E cases covering nested scroll, wide tables, stale modal/chat targets, exact restoration, and all previous selector/region/capture regressions. S17 is next: PDF source detection and original-byte passthrough.",
);

const changelogPath = "CHANGELOG.md";
const changelogMarker = "### Added\n\n";
const changelogText = readFileSync(changelogPath, "utf8");
if (!changelogText.includes(changelogMarker)) {
  throw new Error("CHANGELOG Added marker not found");
}
writeFileSync(
  changelogPath,
  changelogText.replace(
    changelogMarker,
    `${changelogMarker}- Full scrollable-area selection using computed overflow, client/scroll dimensions, sanitized candidate labels, and explicit visible-bounds versus full-scroll-content intent.
- Opaque content-runtime scroll-target snapshots with same-node revalidation, stale-target rejection, bounded settle checks, and exact restoration of container/document scroll and WebCap-owned inline mutations.
- Dedicated two-dimensional internal-scroll capture engine using rate-limited \`captureVisibleTab\`, container content-box crop metadata, overlap-aware logical output rectangles, and immediate local Blob persistence.
- Local sticky-descendant suppression scoped to the selected container, with compare-before-restore cleanup and no implicit scrolling of parent containers.
- Crop-aware PDF and thumbnail composition so full-viewport screenshots contribute only the selected scroll-area pixels.
- Nested vertical container, wide table, and removable modal/chat fixtures; the S16 reference gate passes 248 unit tests across 69 files, four PDF benchmarks, the Manifest V3 build, and 23 Playwright E2E cases.
`,
  ),
  "utf8",
);

replaceOnce("PLAN.md", "current_session: S16", "current_session: S17");
replaceOnce(
  "PLAN.md",
  "| S16 | M5 | Scrollable-container detection và capture | S15 | 22k–30k | NEXT |\n| S17 | M5 | PDF source detection và original passthrough | S16 | 18k–26k | READY |",
  "| S16 | M5 | Scrollable-container detection và capture | S15 | 22k–30k | DONE |\n| S17 | M5 | PDF source detection và original passthrough | S16 | 18k–26k | NEXT |",
);
replaceOnce(
  "PLAN.md",
  "| S16 | NEXT | — | — | — | Sẵn sàng detection/revalidation, 2D internal-scroll capture và exact restore cho scrollable container. |\n| S17 | READY | — | — | — | — |",
  "| S16 | DONE | 2026-08-04 | PR #20 / CI 30876338727 | format, lint, typecheck, 248 unit, 4 PDF benchmarks, build, 23 Playwright E2E | Candidate detection, opaque target revalidation, 2D visible-tab crop capture, sticky-child cleanup, crop-aware PDF/thumbnail và exact restore đã được xác thực trên nested scroll, wide table và stale modal/chat. |\n| S17 | NEXT | — | — | — | Sẵn sàng phát hiện nguồn PDF và passthrough byte nguyên bản khi truy cập an toàn. |",
);
replaceOnce(
  "PLAN.md",
  `Session kế tiếp là **S16 — Scrollable-container detection và capture**.

Khi được yêu cầu tiếp tục code, tôi phải:

1. Đọc \`PLAN.md\` phần S16.
2. Đọc SPEC §19–21, TV-06 và acceptance criteria scroll-area trong PRD.
3. Kiểm tra repo/branch và kết quả CI S15.
4. Chỉ triển khai S16.
5. Kết thúc với scrollable-container candidate detection, stable target revalidation, 2D internal-scroll tile capture, sticky-child policy, exact restore và E2E success/cancel/stale/wide-table.`,
  `Session kế tiếp là **S17 — PDF source detection và original passthrough**.

Khi được yêu cầu tiếp tục code, tôi phải:

1. Đọc \`PLAN.md\` phần S17.
2. Đọc PRD PDF source scope, SPEC M5 và các phần privacy/permission liên quan.
3. Kiểm tra repo/branch và kết quả CI S16.
4. Chỉ triển khai S17.
5. Kết thúc với PDF source detection, capability routing, original-byte passthrough khi an toàn, permission-denied/auth-like fallback trung thực và fixtures public/local.`,
);

const manualPath = "docs/manual-testing.md";
let manualText = readFileSync(manualPath, "utf8").trimEnd();
if (!manualText.includes("## S16 scrollable-area capture and restoration validation")) {
  manualText += `

## S16 scrollable-area capture and restoration validation

1. Build and load the extension, serve \`tests/fixtures/scroll-area.html\`, open WebCap, choose **Vùng cuộn**, and start selection. Hover the nested vertical container and confirm the selector identifies it as scrollable without exposing page text or DOM markup.
2. Confirm the target and observe progress. The document scroll position and every ancestor scroll position must remain stable while only the selected container moves through its internal row-major tile plan.
3. Inspect stored tiles. Each tile must be a non-empty Blob with \`captureViewportCss\` and \`captureCropCss\`; the crop must match the selected container content box while logical output rectangles cover the complete \`scrollWidth\` × \`scrollHeight\` exactly once after overlap resolution.
4. Verify the nested fixture output includes the first and last logical rows, contains no repeated local sticky header, and restores the original \`scrollTop\`, \`scrollLeft\`, focus, document scroll, and WebCap-owned inline style values after completion.
5. Repeat with the wide table container. Confirm the engine creates a two-dimensional internal grid, reaches the far-right and bottom edges, and does not silently truncate when the tile guard would be exceeded.
6. Open the modal/chat-like fixture, begin full-scroll selection, remove the selected node before capture, and confirm retryable \`E_TARGET_STALE\`, zero stored tiles, no replacement-node capture, and complete cleanup.
7. Cancel during internal capture. Confirm the job settles as cancelled, stored partial tiles follow the existing job cleanup policy, and all container/document scroll and style snapshots are restored.
8. Export or thumbnail a captured scroll-area tile set. Confirm PDF/thumbnail composition uses only \`captureCropCss\`, not unrelated pixels from the full viewport screenshot.
9. Inspect runtime/storage boundaries: messages contain opaque target IDs and geometry metadata only; screenshots remain local IndexedDB Blob values; no new permission, remote service, analytics event, or schema migration is introduced.
10. Run \`pnpm test:unit\`, \`pnpm benchmark:pdf\`, and \`pnpm test:e2e\`. The S16 clean reference gate contains 248 unit tests across 69 files, four PDF benchmark cases, and 23 Playwright extension cases including nested scroll, wide table, stale modal/chat, open Shadow DOM, stale element, region, DPR/zoom, PDF, and full-page regressions.
`;
}
writeFileSync(manualPath, `${manualText}\n`, "utf8");
