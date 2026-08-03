import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected text was not found in ${path}: ${before.slice(0, 120)}`);
  }
  const updated = source.replace(before, after);
  await writeFile(path, updated, "utf8");
}

await replaceOnce(
  "src/popup/App.tsx",
  '  capturing: "Đang chụp các tile bằng Chrome DevTools Protocol…",',
  '  capturing: "Đang chụp các tile; WebCap tự chuyển sang scroll fallback khi cần…",',
);
await replaceOnce(
  "src/popup/App.tsx",
  `                CDP không thể hoàn tất
              </h3>
              <p>{fullPageJob.error?.message ?? "Không thể chụp toàn bộ trang."}</p>
              {fullPageJob.error?.fallbackAllowed && (
                <p>Trang này có thể dùng scroll fallback khi S10 được triển khai.</p>
              )}
              <button className="text-action" type="button" onClick={() => void handleRetry()}>
                Thử lại CDP
              </button>`,
  `                Không thể hoàn tất chụp toàn trang
              </h3>
              <p>{fullPageJob.error?.message ?? "Không thể chụp toàn bộ trang."}</p>
              {fullPageJob.activeEngine === "scroll" && (
                <p>Scroll fallback đã dừng an toàn và trang đã được phục hồi.</p>
              )}
              <button className="text-action" type="button" onClick={() => void handleRetry()}>
                Thử lại chụp toàn trang
              </button>`,
);

await replaceOnce(
  "README.md",
  "**S09 — The primary CDP tiled full-page capture engine is complete.** WebCap can prepare a page, measure and plan it in CSS coordinates, capture PNG tiles beyond the viewport through a single short-lived Chrome debugger session, persist every tile immediately in IndexedDB, publish progress, cancel safely, restore the page, and surface a scroll-fallback prompt when CDP cannot attach. The popup now exposes the full-page mode and its tile progress. Final long-image composition, scroll fallback, overlap handling, and the completed fixed/sticky policy remain in S10.",
  "**S10 — The full-page M2 capture foundation is complete.** WebCap first uses the CDP tiled engine and automatically switches to an active-tab scroll fallback for eligible debugger failures. The fallback plans deterministic two-dimensional viewport tiles, records overlap/crop metadata, rate-limits visible captures, supports preserve/remove/smart fixed-element policies, validates stable screenshot scale, stores each PNG Blob immediately in IndexedDB, and restores scroll, focus, styles, and WebCap-owned markers on every exit path. Automated coverage includes fixed headers/footers, a wide table, and a 10,000 CSS-pixel page. Final long-image composition remains deferred to the later export milestones; region selection is next in S11.",
);

await replaceOnce(
  "CHANGELOG.md",
  "### Added\n\n",
  `### Added

- Automatic full-page routing from eligible CDP failures to a rate-limited active-tab scroll capture engine without creating a second job.
- Deterministic two-dimensional scroll tile planning with 64 CSS-pixel overlap, explicit logical output rectangles, edge crop metadata, and max-tile guardrails.
- Preserve, remove, and smart fixed/sticky policies with namespaced inline markers, compare-before-restore cleanup, and service-worker restart recovery.
- Scroll fallback guards for inactive tabs, scroll snapping, document-size drift, implausible screenshot scale, and per-axis pixel-scale changes between tiles.
- Fixed header/footer, sticky header, wide-table, and 10,000 CSS-pixel fixtures plus 10k/30k/100k deterministic planner benchmarks and Playwright fallback coverage.
`,
);

const manualAppend = [
  "",
  "",
  "## S10 scroll fallback, fixed policy, and long-page validation",
  "",
  "1. Build and load the extension, open a disposable HTTP page, choose **Toàn bộ trang**, and keep the source tab active while fallback is running.",
  "2. Attach Chrome DevTools or another debugger to the source tab before starting capture. WebCap must fail CDP attachment, reuse the same persistent job, delete any partial CDP tiles, switch `activeEngine` to `scroll`, and finish with a new complete tile plan.",
  "3. Inspect IndexedDB `tiles`: every scroll tile must contain a non-empty PNG Blob, row/column/index metadata, the raw viewport `sourceRectCss`, a logical `outputRectCss`, and overlap/crop fields. Logical output rectangles must cover the target without a gap.",
  "4. On `tests/fixtures/fixed-header-footer.html` with the default smart policy, confirm the bottom fixed element is hidden on the first tile, both repeated edge elements are hidden on middle tiles, and the top fixed element is hidden on the final tile. No `data-webcap-scroll-*` marker or inline-style mutation may remain afterward.",
  "5. Repeat on `tests/fixtures/sticky-header.html` and verify sticky candidates are treated by the selected preserve/remove/smart policy without duplicating the header outside that policy.",
  "6. On `tests/fixtures/wide-table.html`, confirm fallback creates multiple rows and columns, horizontal and vertical overlap metadata are present, and the page returns to its original scroll/focus/style state.",
  "7. On `tests/fixtures/long-page-10k.html`, confirm the active-tab fallback captures at least 19 tiles, completes within the E2E timeout, and restores the original scroll position. The CI reference run completed this case in about 25.4 seconds.",
  "8. Change tabs during fallback and confirm the job fails with `E_TAB_NOT_ACTIVE` before another screenshot is stored. Add scroll snapping or change document dimensions during capture and confirm `E_LAYOUT_UNSTABLE` cleanup.",
  "9. Verify screenshot scale is calibrated from the first visible tile independently on the X and Y axes, while later tiles must retain both scales within two pixels; this accommodates scrollbar geometry without accepting zoom/DPR drift.",
  "10. Run `pnpm test:unit` for deterministic 10k/30k/100k planning and `pnpm test:e2e` for CDP success, automatic fallback, smart fixed policy, 2D wide-table coverage, 10k capture, page restoration, cancellation, and visible-capture regressions.",
  "",
  "Reference validation on Chrome for Testing 151: smart fixed fixture about 9.2 seconds, wide-table 2D fixture about 11.2 seconds, and 10k fallback fixture about 25.4 seconds. The 30k and 100k cases remain deterministic planner/guardrail benchmarks because a full rate-limited browser capture would intentionally lengthen CI; their planned tile counts are 56 and 187 respectively.",
  "",
].join("\n");
const manual = await readFile("docs/manual-testing.md", "utf8");
if (!manual.includes("## S10 scroll fallback, fixed policy, and long-page validation")) {
  await writeFile("docs/manual-testing.md", `${manual.trimEnd()}${manualAppend}`, "utf8");
}

await replaceOnce("PLAN.md", "current_session: S10", "current_session: S11");
await replaceOnce(
  "PLAN.md",
  "| S10 | M2 | Scroll fallback, fixed policy và long-page validation | S09 | 22k–30k | NEXT |\n| S11 | M3 | CoordinateSpace và region selector | S10 | 18k–26k | READY |",
  "| S10 | M2 | Scroll fallback, fixed policy và long-page validation | S09 | 22k–30k | DONE |\n| S11 | M3 | CoordinateSpace và region selector | S10 | 18k–26k | NEXT |",
);
await replaceOnce(
  "PLAN.md",
  "**Commit gợi ý:** `Add full-page scroll fallback`.\n\n---\n\n## S11 — CoordinateSpace và region selector",
  `**Commit gợi ý:** \`Add full-page scroll fallback\`.

**Hoàn thành:** 2026-08-03 · PR #14 · validation code head \`2d6f39c\` · CI run \`30791809060\`.

**Ghi chú kỹ thuật:** coordinator thử CDP trước và chỉ chuyển cùng persistent job sang scroll engine khi lỗi cho phép fallback; tile CDP dở được xóa trước plan mới. Scroll engine giữ tab nguồn active, rate-limit 550 ms, lập grid 2D row-major với overlap/crop metadata, hiệu chỉnh pixel scale X/Y từ tile đầu và chặn scale/layout/scroll drift. Fixed mode preserve/remove/smart dùng marker namespace và compare-before-restore; cleanup chạy trước S08 restore và cả recovery sau service-worker restart. CI sạch pass format, lint, strict typecheck, 174 unit tests, build và 11 Playwright E2E, gồm smart fixed, wide-table 2D và capture 10k CSS px khoảng 25,4 giây; planner 30k/100k lần lượt 56/187 tile.

---

## S11 — CoordinateSpace và region selector`,
);
await replaceOnce(
  "PLAN.md",
  "| S10 | NEXT | — | — | — | Sẵn sàng triển khai scroll fallback, fixed policy và long-page validation. |\n| S11 | READY | — | — | — | — |",
  "| S10 | DONE | 2026-08-03 | PR #14 / 2d6f39c / CI 30791809060 | format, lint, typecheck, 174 unit, build, 11 Playwright E2E | Automatic CDP fallback, overlap/crop metadata, fixed policy, exact cleanup và 10k/30k/100k validation đã được xác thực. |\n| S11 | NEXT | — | — | — | Sẵn sàng triển khai CoordinateSpace và region selector. |",
);
await replaceOnce(
  "PLAN.md",
  `Session kế tiếp là **S10 — Scroll fallback, fixed policy và long-page validation**.

Khi được yêu cầu tiếp tục code, tôi phải:

1. Đọc \`PLAN.md\` phần S10.
2. Đọc SPEC scroll fallback/fixed/overlap sections §14–17 và test/performance §27.
3. Kiểm tra repo/branch và kết quả CI S09.
4. Chỉ triển khai S10.
5. Kết thúc với fallback usable, overlap/crop metadata, fixed policy, automatic fallback routing và benchmark/visual validation trên trang dài.`,
  `Session kế tiếp là **S11 — CoordinateSpace và region selector**.

Khi được yêu cầu tiếp tục code, tôi phải:

1. Đọc \`PLAN.md\` phần S11.
2. Đọc SPEC §18, coordinate contracts và UI M3.
3. Kiểm tra repo/branch và kết quả CI S10.
4. Chỉ triển khai S11.
5. Kết thúc với CoordinateSpace pure module, overlay accessible, drag/resize/keyboard flow, auto-scroll, target rect document coordinates và E2E zoom/DPR.`,
);
