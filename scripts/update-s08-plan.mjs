import { readFile, writeFile } from "node:fs/promises";

const path = "PLAN.md";
let source = await readFile(path, "utf8");

const replacements = [
  ["current_session: S08", "current_session: S09"],
  [
    "| S08 | M2 | Page preparation, lazy settle và restoration | S07 | 20k–28k | NEXT |\n| S09 | M2 | CDP tiled full-page capture, progress và cancel | S08 | 22k–30k | READY |",
    "| S08 | M2 | Page preparation, lazy settle và restoration | S07 | 20k–28k | DONE |\n| S09 | M2 | CDP tiled full-page capture, progress và cancel | S08 | 22k–30k | NEXT |",
  ],
  [
    "**Hoàn thành:** 2026-08-03 · PR #11 · validation head `a514f72`.",
    "**Hoàn thành:** 2026-08-03 · PR #11 · final head `fb03138` · squash `15b4ec6`.",
  ],
  [
    "**Commit gợi ý:** `Add page preparation and restoration`.\n\n---\n\n## S09 — CDP tiled full-page capture, progress và cancel",
    "**Commit gợi ý:** `Add page preparation and restoration`.\n\n**Hoàn thành:** 2026-08-03 · PR #12 · validation head `b1f07eb`.\n\n**Ghi chú kỹ thuật:** background/content dùng protocol versioned và content runtime classic tự chứa, chỉ inject theo yêu cầu. Preparation snapshot scroll, focus, selection, freeze style và WebCap-owned inline mutations; lazy pre-scroll có RAF, MutationObserver, ResizeObserver, image decode best-effort, timeout/height/cancel guardrails. Restore idempotent dùng compare-before-restore, giữ nguyên inline `style` attribute, không ghi đè thay đổi mới của trang và chuẩn hóa partial cleanup thành `E_CLEANUP_PARTIAL` mà không che lỗi operation chính. CI sạch pass format, lint, strict typecheck, 150 unit tests, build verifier và 5 Playwright E2E gồm lazy/animation/layout-shift/fixed-sticky/cancel cùng hai visible-capture regressions.\n\n---\n\n## S09 — CDP tiled full-page capture, progress và cancel",
  ],
  [
    "| S07 | DONE | 2026-08-03 | PR #11 / a514f72 | format, lint, typecheck, 136 unit, build, 2 Playwright E2E | Debugger ownership/timeouts/detach, CSS metrics normalization và deterministic 2D tile planning 10k/30k/100k đã được xác thực. |\n| S08 | NEXT | — | — | — | Sẵn sàng triển khai page preparation, lazy settle và restoration. |\n| S09 | READY | — | — | — | — |",
    "| S07 | DONE | 2026-08-03 | PR #11 / fb03138 / squash 15b4ec6 | format, lint, typecheck, 136 unit, build, 2 Playwright E2E | Debugger ownership/timeouts/detach, CSS metrics normalization và deterministic 2D tile planning 10k/30k/100k đã được xác thực. |\n| S08 | DONE | 2026-08-03 | PR #12 / b1f07eb | format, lint, typecheck, 150 unit, build, 5 Playwright E2E | Content preparation protocol, bounded lazy/layout settle, exact compare-before-restore và success/error/cancel cleanup đã được xác thực. |\n| S09 | NEXT | — | — | — | Sẵn sàng triển khai CDP tiled full-page capture, progress và cancel. |",
  ],
  [
    "Session kế tiếp là **S08 — Page preparation, lazy settle và restoration**.\n\nKhi được yêu cầu tiếp tục code, tôi phải:\n\n1. Đọc `PLAN.md` phần S08.\n2. Đọc SPEC page preparation/restoration/lazy/fixed sections §15–17 và fixtures §27.\n3. Kiểm tra repo/branch và kết quả CI S07.\n4. Chỉ triển khai S08.\n5. Kết thúc với content-script preparation, deterministic settle và idempotent restoration trên success/error/cancel đầy đủ test.",
    "Session kế tiếp là **S09 — CDP tiled full-page capture, progress và cancel**.\n\nKhi được yêu cầu tiếp tục code, tôi phải:\n\n1. Đọc `PLAN.md` phần S09.\n2. Đọc SPEC §13–17, job/state sections và UI M2.\n3. Kiểm tra repo/branch và kết quả CI S08.\n4. Chỉ triển khai S09.\n5. Kết thúc với prepare → measure → plan → capture tiles → store → ready, progress/cancel checkpoints, debugger detach và page restore đầy đủ test.",
  ],
];

for (const [before, after] of replacements) {
  if (!source.includes(before)) {
    throw new Error(`Expected PLAN.md pattern was not found: ${before.slice(0, 120)}`);
  }
  source = source.replace(before, after);
}

await writeFile(path, source, "utf8");
