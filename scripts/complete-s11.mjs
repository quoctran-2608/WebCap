import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected text was not found in ${path}: ${before.slice(0, 160)}`);
  }
  await writeFile(path, source.replace(before, after), "utf8");
}

await replaceOnce(
  "README.md",
  "**S10 — The full-page M2 capture foundation is complete.** WebCap first uses the CDP tiled engine and automatically switches to an active-tab scroll fallback for eligible debugger failures. The fallback plans deterministic two-dimensional viewport tiles, records overlap/crop metadata, rate-limits visible captures, supports preserve/remove/smart fixed-element policies, validates stable screenshot scale, stores each PNG Blob immediately in IndexedDB, and restores scroll, focus, styles, and WebCap-owned markers on every exit path. Automated coverage includes fixed headers/footers, a wide table, and a 10,000 CSS-pixel page. Final long-image composition remains deferred to the later export milestones; region selection is next in S11.",
  "**S11 — Region capture selection is complete.** WebCap now exposes the region mode, opens an isolated Shadow DOM overlay on the source page, supports drag creation, moving, eight resize handles, arrow-key nudging, Enter/Escape, and edge auto-scroll, then confirms a target in CSS document coordinates. The overlay restores the original scroll and focus, removes itself, waits two animation frames, and routes the same persistent job through the existing CDP/scroll tiled engines. Popup recovery uses a metadata-only active-job lookup, and automated coverage validates a region longer than the viewport, overlay exclusion from captured pixels, clean cancellation, exact page restoration, DPR 2, and 125% zoom. Element selection is next in S12; final image composition remains in later export milestones.",
);

await replaceOnce(
  "CHANGELOG.md",
  "### Added\n\n",
  `### Added

- Region capture mode with a typed selection lifecycle that creates a persistent job before the popup closes and starts tiled capture only after the page confirms a target rectangle.
- A pure CoordinateSpace module for client, visual viewport, CSS document, and device-pixel conversions with bounds normalization, movement, eight-direction resizing, and edge auto-scroll calculations.
- An isolated Shadow DOM region overlay with drag, move, eight resize handles, dimensions, keyboard nudging, Enter confirmation, Escape cancellation, and two-frame removal before capture.
- Metadata-only active-job lookup so reopening the popup restores in-progress or ready full-page/region jobs without reading tile Blob payloads into session storage.
- Region target capture through the existing CDP-first and scroll-fallback engines, including target-start preparation, durable per-tile storage, progress, cancellation, and exact restoration.
- Region-selection fixtures and Playwright coverage for a target longer than the viewport, captured-pixel overlay exclusion, popup recovery, Escape cancellation, DPR 2, and 125% zoom.
`,
);

const manualAppend = `

## S11 CoordinateSpace and region selector inspection

1. Build and load the extension, serve \`tests/fixtures/region-selection.html\`, open WebCap, select **Vùng tự chọn**, and click **Bắt đầu chọn vùng**.
2. Confirm a single \`data-webcap-region-selector\` root is injected. Its controls and styles must live inside an isolated Shadow DOM; the page must not receive global selector classes or styles.
3. Drag from an empty page point to create a selection, drag the selection body to move it, and use all eight handles to resize it. The displayed dimensions must track the CSS document rectangle.
4. Use arrow keys to nudge by one CSS pixel and Shift+arrow to nudge by ten. Press Enter to confirm or Escape to cancel; keyboard focus must remain visible on actionable controls.
5. Drag near the bottom or side of the viewport. The page should auto-scroll while the stored target continues growing in document coordinates and can extend beyond the initial viewport.
6. Confirming must remove the overlay before page preparation/capture begins and wait at least two animation frames. The captured PNG tile must contain page pixels at the selection origin, not the yellow selector border or dimming mask.
7. Inspect the region job in IndexedDB: \`mode\` is \`region\`, \`targetRect\` is the confirmed CSS document rectangle, the job progresses through the existing tiled coordinator, and every stored tile is a non-empty Blob. Session storage remains metadata-only.
8. Close or reopen the popup after selection/capture. With the source tab active, WebCap should recover the latest active/ready region job through \`JOB_GET_ACTIVE\` and show its correct progress or ready state.
9. Press Escape before confirming. The selector root must disappear, no tiles should be stored, the job must settle as \`cancelled\` with \`E_CANCELLED\`, cleanup must be complete, and scroll/focus/document/body styles must match the pre-selection snapshot.
10. Repeat at DPR 2 and Chrome zoom 125%. The confirmed \`targetRect\` must remain stable in CSS document coordinates while the capture engine handles screenshot pixel scale separately.

Run \`pnpm test:unit\` for the coordinate matrix, protocol, selector service, router, active-job lookup, and cancellation semantics. Run \`pnpm test:e2e\` for region auto-scroll capture, overlay pixel exclusion, popup recovery, Escape cancellation, zoom/DPR, and all existing visible/full-page regressions. Reference CI run \`30799895160\` passed 188 unit tests across 49 files and 14 Playwright tests on Chrome for Testing 151.
`;
const manual = await readFile("docs/manual-testing.md", "utf8");
if (!manual.includes("## S11 CoordinateSpace and region selector inspection")) {
  await writeFile("docs/manual-testing.md", `${manual.trimEnd()}${manualAppend}`, "utf8");
}

await replaceOnce("PLAN.md", "current_session: S11", "current_session: S12");
await replaceOnce(
  "PLAN.md",
  "| S11 | M3 | CoordinateSpace và region selector | S10 | 18k–26k | NEXT |\n| S12 | M3 | Element selector và target capture | S11 | 18k–26k | READY |",
  "| S11 | M3 | CoordinateSpace và region selector | S10 | 18k–26k | DONE |\n| S12 | M3 | Element selector và target capture | S11 | 18k–26k | NEXT |",
);
await replaceOnce(
  "PLAN.md",
  "**Commit gợi ý:** `Implement region capture selector`.\n\n---\n\n## S12 — Element selector và target capture",
  `**Commit gợi ý:** \`Implement region capture selector\`.

**Hoàn thành:** 2026-08-03 · PR #15 · validation head \`798fd47\` · CI run \`30799895160\`.

**Ghi chú kỹ thuật:** \`CoordinateSpace\` chuẩn hóa client/visual viewport/document/device-pixel coordinates và cung cấp pure helpers cho normalize, clamp, move, tám resize directions và edge auto-scroll. Content runtime bundle IIFE mở overlay Shadow DOM cô lập, hỗ trợ drag/move/resize, keyboard nudge, Enter/Escape, khôi phục scroll/focus, tháo overlay rồi chờ hai RAF trước commit. Region job được tạo trước khi popup đóng, target rect lưu trong CSS document coordinates và chạy qua cùng CDP-first/scroll-fallback coordinator; \`JOB_GET_ACTIVE\` chỉ trả metadata để popup phục hồi. CI read-only pass format, lint, strict typecheck, 188 unit tests, build và 14 Playwright E2E, gồm vùng dài hơn viewport, pixel proof overlay không lọt output, popup reopen, cancel sạch và DPR 2/zoom 125%.

---

## S12 — Element selector và target capture`,
);
await replaceOnce(
  "PLAN.md",
  "| S11 | NEXT | — | — | — | Sẵn sàng triển khai CoordinateSpace và region selector. |\n| S12 | READY | — | — | — | — |",
  "| S11 | DONE | 2026-08-03 | PR #15 / 798fd47 / CI 30799895160 | format, lint, typecheck, 188 unit, build, 14 Playwright E2E | CoordinateSpace, overlay accessible, auto-scroll, persistent region job, target capture, exact restore và zoom/DPR đã được xác thực. |\n| S12 | NEXT | — | — | — | Sẵn sàng triển khai element selector và stale-target handling. |",
);
await replaceOnce(
  "PLAN.md",
  `Session kế tiếp là **S11 — CoordinateSpace và region selector**.

Khi được yêu cầu tiếp tục code, tôi phải:

1. Đọc \`PLAN.md\` phần S11.
2. Đọc SPEC §18, coordinate contracts và UI M3.
3. Kiểm tra repo/branch và kết quả CI S10.
4. Chỉ triển khai S11.
5. Kết thúc với CoordinateSpace pure module, overlay accessible, drag/resize/keyboard flow, auto-scroll, target rect document coordinates và E2E zoom/DPR.`,
  `Session kế tiếp là **S12 — Element selector và target capture**.

Khi được yêu cầu tiếp tục code, tôi phải:

1. Đọc \`PLAN.md\` phần S12.
2. Đọc SPEC §19 và phần scroll candidate §20.
3. Kiểm tra repo/branch và kết quả CI S11.
4. Chỉ triển khai S12.
5. Kết thúc với hover/highlight, parent-child keyboard navigation, stable target descriptor, revalidation, \`E_TARGET_STALE\`, open Shadow DOM fixture và E2E normal/shadow/stale.`,
);
