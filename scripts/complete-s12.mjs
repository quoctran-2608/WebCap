import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let content = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (!content.includes(before)) {
      throw new Error(`Missing patch pattern in ${path}: ${before.slice(0, 160)}`);
    }
    content = content.replace(before, after);
  }
  await writeFile(path, content, "utf8");
}

await patch("README.md", [
  [
    `**S11 — Region capture selection is complete.** WebCap now exposes the region mode, opens an isolated Shadow DOM overlay on the source page, supports drag creation, moving, eight resize handles, arrow-key nudging, Enter/Escape, and edge auto-scroll, then confirms a target in CSS document coordinates. The overlay restores the original scroll and focus, removes itself, waits two animation frames, and routes the same persistent job through the existing CDP/scroll tiled engines. Popup recovery uses a metadata-only active-job lookup, and automated coverage validates a region longer than the viewport, overlay exclusion from captured pixels, clean cancellation, exact page restoration, DPR 2, and 125% zoom. Element selection is next in S12; final image composition remains in later export milestones.`,
    `**S12 — Element capture selection is complete.** WebCap now exposes element mode with an isolated Shadow DOM selector, sanitized tag/id/class labels, live dimensions, click selection, parent/previous-child keyboard navigation, Enter/Escape, scrollable-candidate metadata, and recursive hit testing through open Shadow DOM. The persistent job stores only an opaque descriptor and CSS document rectangle; the actual DOM identity stays inside the content runtime and is revalidated after page preparation and immediately before every engine attempt. A removed or replaced target fails safely with retryable \`E_TARGET_STALE\` and a reselection flow instead of capturing another node. Normal, open-shadow, stale, keyboard-cancel, exact restoration, CDP tile capture, and all previous region/full-page/visible paths are covered by automation. PDF page slicing and page-at-a-time export are next in S13; full scrollable-element content remains reserved for S16.`,
  ],
]);

await patch("CHANGELOG.md", [
  [
    `### Added\n\n`,
    `### Added\n\n- Element capture mode with an isolated Shadow DOM hover/highlight selector, sanitized tag/id/class labels, dimensions, click confirmation, Enter/Escape controls, and parent/previous-child keyboard navigation.\n- Recursive open-Shadow-DOM hit testing with \`elementsFromPoint()\`, \`composedPath()\` fallback, invalid-root/WebCap-root exclusion, and scrollable-candidate metadata.\n- Opaque element target descriptors backed by content-runtime node identity, CSS document bounds through the shared CoordinateSpace, and revalidation after preparation plus immediately before each capture-engine attempt.\n- Safe retryable \`E_TARGET_STALE\` handling that never substitutes a replacement node, preserves zero stored tiles on stale failure, restores the page, and exposes popup reselection.\n- Element selection protocol, background service/router integration, persistent popup recovery, CDP-first/scroll-fallback target capture, and 200-unit/18-E2E validation including normal, open-shadow, stale, and keyboard-cancel fixtures.\n`,
  ],
]);

const manualPath = "docs/manual-testing.md";
let manual = await readFile(manualPath, "utf8");
manual += `\n\n## S12 element selector and stale-target validation\n\n1. Build and load the extension, serve \`tests/fixtures/element-selection.html\`, open WebCap, choose **Phần tử**, and start selection.\n2. Move the pointer over nested elements. Confirm the cyan highlight follows the deepest valid candidate and the label contains only sanitized tag, optional id, up to three classes, and visible dimensions; page text must not be copied into persistent metadata.\n3. Click the violet child panel, press **ArrowUp** to select its article parent, then **ArrowDown** to return to the previously selected child. Press **Enter** and confirm the stored CSS document rectangle matches the child bounds and the resulting PNG tile contains the violet target rather than the selector UI.\n4. Repeat on the open shadow-root button. Confirm WebCap selects \`button#shadow-action.shadow-button\` rather than only the custom-element host, even after the fixture was scrolled before selection.\n5. Select the stale fixture target, remove it from the page before pressing Enter, and confirm the job fails with retryable \`E_TARGET_STALE\`, stores no tiles, restores scroll/focus/styles, and offers **Chọn lại phần tử**. Replacing it with another node at the same position must not be accepted as the original identity.\n6. Start selection with the focus fixture button active, confirm the selector dialog and Hủy button are keyboard reachable, press **Escape**, and verify the job is cancelled with \`E_CANCELLED\` while the original focus, scroll, and inline styles are restored.\n7. Inspect IndexedDB: the job may contain the sanitized opaque target descriptor and CSS rectangle, but not a DOM node, page text, HTML, screenshot bytes, or selector state. Binary tiles remain Blob values in the tile store.\n8. Verify normal element capture revalidates the same content-runtime identity after page preparation and again before the engine attempt; moving the same connected node may update its bounds, but disconnecting/replacing it must stop capture.\n9. A scrollable candidate is labelled as scrollable but S12 captures visible bounds only. Full internal scroll content remains disabled until S16. Closed shadow-root deep inspection is unsupported and must not be represented as available.\n10. Run \`pnpm test:unit\` and \`pnpm test:e2e\`. The reference S12 suite contains 200 unit tests across 53 files and 18 Playwright cases, including all prior visible, full-page, fallback, preparation, and region regressions.\n`;
await writeFile(manualPath, manual, "utf8");

await patch("PLAN.md", [
  [`current_session: S12`, `current_session: S13`],
  [
    `| S12 | M3 | Element selector và target capture | S11 | 18k–26k | NEXT |\n| S13 | M4 | PDF page slicing và page-at-a-time exporter | S12 | 20k–28k | READY |`,
    `| S12 | M3 | Element selector và target capture | S11 | 18k–26k | DONE |\n| S13 | M4 | PDF page slicing và page-at-a-time exporter | S12 | 20k–28k | NEXT |`,
  ],
  [
    `| S12 | NEXT | — | — | — | Sẵn sàng triển khai element selector và stale-target handling. |\n| S13 | READY | — | — | — | — |`,
    `| S12 | DONE | 2026-08-03 | PR #16 / 8a74815 / CI 30805006996 | format, lint, typecheck, 200 unit, build, 18 Playwright E2E | Hover/highlight, sanitized descriptor, parent-child keyboard flow, open Shadow DOM, double revalidation, stale-target safety, exact restore và reselection đã được xác thực. |\n| S13 | NEXT | — | — | — | Sẵn sàng triển khai PDF page slicing và page-at-a-time exporter. |`,
  ],
  [
    `Session kế tiếp là **S12 — Element selector và target capture**.\n\nKhi được yêu cầu tiếp tục code, tôi phải:\n\n1. Đọc \`PLAN.md\` phần S12.\n2. Đọc SPEC §19 và phần scroll candidate §20.\n3. Kiểm tra repo/branch và kết quả CI S11.\n4. Chỉ triển khai S12.\n5. Kết thúc với hover/highlight, parent-child keyboard navigation, stable target descriptor, revalidation, \`E_TARGET_STALE\`, open Shadow DOM fixture và E2E normal/shadow/stale.`,
    `Session kế tiếp là **S13 — PDF page slicing và page-at-a-time exporter**.\n\nKhi được yêu cầu tiếp tục code, tôi phải:\n\n1. Đọc \`PLAN.md\` phần S13.\n2. Đọc SPEC §21–23, TV-02 và acceptance criteria PDF trong PRD.\n3. Kiểm tra repo/branch và kết quả CI S12.\n4. Chỉ triển khai S13.\n5. Kết thúc với unit conversion, pure page slicing, tile-to-page intersections, page-at-a-time offscreen canvas, PDF artifact persistence, export progress và integrity tests không tạo canvas toàn trang.`,
  ],
]);
