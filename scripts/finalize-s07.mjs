import { readFile, writeFile } from "node:fs/promises";

async function replaceExactlyOnce(path, replacements) {
  let text = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    const first = text.indexOf(before);
    if (first === -1 || text.indexOf(before, first + before.length) !== -1) {
      throw new Error(`${path}: expected exactly one match for ${JSON.stringify(before)}`);
    }
    text = `${text.slice(0, first)}${after}${text.slice(first + before.length)}`;
  }
  await writeFile(path, text, "utf8");
}

await replaceExactlyOnce("PLAN.md", [
  ["current_session: S07", "current_session: S08"],
  [
    "| S07 | M2 | Debugger client, page metrics và 2D tile planner | S06 | 20k–28k | NEXT |",
    "| S07 | M2 | Debugger client, page metrics và 2D tile planner | S06 | 20k–28k | DONE |",
  ],
  [
    "| S08 | M2 | Page preparation, lazy settle và restoration | S07 | 20k–28k | READY |",
    "| S08 | M2 | Page preparation, lazy settle và restoration | S07 | 20k–28k | NEXT |",
  ],
  [
    "**Commit gợi ý:** `Implement debugger metrics and tile planner`.\n\n---",
    "**Commit gợi ý:** `Implement debugger metrics and tile planner`.\n\n**Hoàn thành:** 2026-08-03 · PR #11 · validation head `a514f72`.\n\n**Ghi chú kỹ thuật:** typed `chrome.debugger` adapter và `DebuggerClient` giới hạn một session sở hữu trên mỗi tab, áp dụng attach/command timeout, chuẩn hóa attach/CDP/unexpected-detach/cleanup errors và detach trên mọi path đã xác nhận. `Page.getLayoutMetrics` ưu tiên CSS metrics, kết hợp `Runtime.evaluate` cho DPR; planner sinh grid 2D row-major deterministic, clamp target, giữ edge remainder, chặn zero/gap, max pixel area/max tiles và hỗ trợ dynamic split. CI sạch pass format, lint, strict typecheck, 136 unit tests, build và 2 Playwright visible-capture E2E.\n\n---",
  ],
  [
    "| S07 | NEXT | — | — | — | Sẵn sàng triển khai debugger client, page metrics và 2D tile planner. |",
    "| S07 | DONE | 2026-08-03 | PR #11 / a514f72 | format, lint, typecheck, 136 unit, build, 2 Playwright E2E | Debugger ownership/timeouts/detach, CSS metrics normalization và deterministic 2D tile planning 10k/30k/100k đã được xác thực. |",
  ],
  [
    "| S08 | READY | — | — | — | — |",
    "| S08 | NEXT | — | — | — | Sẵn sàng triển khai page preparation, lazy settle và restoration. |",
  ],
  [
    "Session kế tiếp là **S07 — Debugger client, page metrics và 2D tile planner**.",
    "Session kế tiếp là **S08 — Page preparation, lazy settle và restoration**.",
  ],
  [
    "1. Đọc `PLAN.md` phần S07.\n2. Đọc SPEC debugger/metrics/tile sections §13–16, TV-01 và error model.\n3. Kiểm tra repo/branch và kết quả CI S06.\n4. Chỉ triển khai S07.\n5. Kết thúc với debugger attach/detach an toàn, normalized page metrics và 2D tile planner deterministic đầy đủ test.",
    "1. Đọc `PLAN.md` phần S08.\n2. Đọc SPEC page preparation/restoration/lazy/fixed sections §15–17 và fixtures §27.\n3. Kiểm tra repo/branch và kết quả CI S07.\n4. Chỉ triển khai S08.\n5. Kết thúc với content-script preparation, deterministic settle và idempotent restoration trên success/error/cancel đầy đủ test.",
  ],
]);

await replaceExactlyOnce("README.md", [
  [
    "**S06 — The persistent capture-job foundation is complete.** WebCap now stores full capture jobs and tile records in IndexedDB, keeps metadata-only recovery summaries and per-tab leases in `chrome.storage.session`, rejects stale state revisions, restores interrupted jobs after service-worker restart, and deduplicates persistent job commands by request ID. The next session is S07 debugger metrics and deterministic 2D tile planning.",
    "**S07 — The debugger measurement and tile-planning foundation is complete.** WebCap now owns short-lived Chrome debugger sessions safely, normalizes CSS page metrics plus DPR/zoom, and creates deterministic 2D tile grids with edge, area, count, and dynamic-split guardrails. The next session is S08 page preparation, lazy-load settling, and restoration.",
  ],
  [
    "src/background/         Manifest V3 service worker and message routing.\nsrc/popup/",
    "src/background/         Manifest V3 service worker and message routing.\nsrc/capture/            Page measurement and deterministic capture planning.\nsrc/popup/",
  ],
]);

await replaceExactlyOnce("CHANGELOG.md", [
  [
    "### Added\n\n",
    "### Added\n\n- Typed Chrome debugger adapter and owned-session client with attach/command timeouts, unexpected-detach handling, and deterministic cleanup.\n- CSS-first `Page.getLayoutMetrics` normalization with layout/visual viewports, device pixel ratio, zoom, and legacy-field fallback.\n- Deterministic row-major 2D tile planner with target clamping, edge remainders, pixel-area and tile-count guardrails, and dynamic rectangle splitting.\n- Coverage for short, wide, fractional, 10k, 30k, and 100k CSS-pixel pages plus debugger success, error, timeout, and detach paths.\n",
  ],
]);

const manualPath = "docs/manual-testing.md";
const manual = await readFile(manualPath, "utf8");
const heading = "## S07 debugger metrics and tile planning inspection";
if (manual.includes(heading)) {
  throw new Error(`${manualPath}: S07 section already exists`);
}
const addition = `

${heading}

S07 remains an infrastructure milestone and does not expose a full-page capture button yet. Use the unit suite as the deterministic gate, and inspect a development invocation of \`CdpMeasurementService\` only on a disposable web tab:

1. Confirm WebCap attaches with protocol version \`0.1\`, enables the Page domain, reads \`Page.getLayoutMetrics\`, evaluates \`window.devicePixelRatio\`, and detaches immediately after measurement/planning.
2. Open Chrome DevTools or another debugger before measurement; WebCap must return a normalized retryable \`E_DEBUGGER_ATTACH\` instead of stealing or hiding the existing debugger session.
3. Close or cancel the debugger while the task is active; WebCap must surface \`E_DEBUGGER_DETACHED\` and release its per-tab ownership.
4. Inspect normalized metrics: CSS content size is preferred, layout/visual viewport scroll offsets are retained, DPR and zoom are finite positive values, and no page URL/content is logged.
5. Plan short, wide, fractional, 10k, 30k, and 100k CSS-pixel rectangles. Tile IDs and indexes must be stable row-major values; final rows/columns cover only the remainder with no gap, overlap, negative, or zero dimension.
6. Raise pixel scale or lower the pixel-area guardrail and confirm tile height shrinks or dynamic splitting produces safe sub-rectangles; exceeding \`maxTiles\` must fail with \`E_TILE_PLAN\`.

Run \`pnpm test:unit\` for debugger/metrics/planner behavior and \`pnpm test:e2e\` to preserve the completed visible-capture regression slice.
`;
await writeFile(manualPath, `${manual.trimEnd()}${addition}\n`, "utf8");
