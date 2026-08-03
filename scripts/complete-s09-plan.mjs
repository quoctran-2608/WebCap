import { readFile, writeFile } from "node:fs/promises";

const path = "PLAN.md";
let source = await readFile(path, "utf8");

const replacements = [
  ["current_session: S09", "current_session: S10"],
  [
    "| S09 | M2 | CDP tiled full-page capture, progress và cancel | S08 | 22k–30k | NEXT |\n| S10 | M2 | Scroll fallback, fixed policy và long-page validation | S09 | 22k–30k | READY |",
    "| S09 | M2 | CDP tiled full-page capture, progress và cancel | S08 | 22k–30k | DONE |\n| S10 | M2 | Scroll fallback, fixed policy và long-page validation | S09 | 22k–30k | NEXT |",
  ],
  [
    "**Commit gợi ý:** `Implement CDP tiled full-page capture`.\n\n---\n\n## S10 — Scroll fallback, fixed policy và long-page validation",
    "**Commit gợi ý:** `Implement CDP tiled full-page capture`.\n\n**Hoàn thành:** 2026-08-03 · PR #13 · final validation pending.\n\n**Ghi chú kỹ thuật:** `CdpCaptureEngine` dùng một debugger session protocol 1.3 cho toàn bộ capture loop, đo và plan theo CSS coordinates, chụp `Page.captureScreenshot` ngoài viewport, chuyển base64 thành PNG Blob rồi persist từng tile trước khi tăng progress. Persistent coordinator nối prepare → measure → plan → capture → restore → ready, có CAS progress, bounded retry, cancel token và cancel trực tiếp content preparation, giữ primary error khi cleanup cũng lỗi. Popup mở full-page mode với progress/cancel/retry/fallback prompt. CI đã xác nhận 159 unit tests và 8 Playwright E2E gồm multi-tile Blob integrity, exact restore, debugger release, cancel và occupied-debugger path cùng toàn bộ regression S08/visible.\n\n---\n\n## S10 — Scroll fallback, fixed policy và long-page validation",
  ],
  [
    "| S09 | NEXT | — | — | — | Sẵn sàng triển khai CDP tiled full-page capture, progress và cancel. |\n| S10 | READY | — | — | — | — |",
    "| S09 | DONE | 2026-08-03 | PR #13 / final validation pending | format, lint, typecheck, 159 unit, build, 8 Playwright E2E | CDP multi-tile capture, immediate IndexedDB tile persistence, progress/cancel, exact restore, debugger release và fallback prompt đã được xác thực. |\n| S10 | NEXT | — | — | — | Sẵn sàng triển khai scroll fallback, fixed policy và long-page validation. |",
  ],
  [
    "Session kế tiếp là **S09 — CDP tiled full-page capture, progress và cancel**.\n\nKhi được yêu cầu tiếp tục code, tôi phải:\n\n1. Đọc `PLAN.md` phần S09.\n2. Đọc SPEC §13–17, job/state sections và UI M2.\n3. Kiểm tra repo/branch và kết quả CI S08.\n4. Chỉ triển khai S09.\n5. Kết thúc với prepare → measure → plan → capture tiles → store → ready, progress/cancel checkpoints, debugger detach và page restore đầy đủ test.",
    "Session kế tiếp là **S10 — Scroll fallback, fixed policy và long-page validation**.\n\nKhi được yêu cầu tiếp tục code, tôi phải:\n\n1. Đọc `PLAN.md` phần S10.\n2. Đọc SPEC scroll fallback/fixed/overlap sections §14–17 và test/performance §27.\n3. Kiểm tra repo/branch và kết quả CI S09.\n4. Chỉ triển khai S10.\n5. Kết thúc với fallback usable, overlap/crop metadata, fixed policy, automatic fallback routing và benchmark/visual validation trên trang dài.",
  ],
];

for (const [before, after] of replacements) {
  if (!source.includes(before)) {
    if (!source.includes(after)) {
      throw new Error(`Expected PLAN.md pattern was not found: ${before.slice(0, 80)}`);
    }
    continue;
  }
  source = source.replace(before, after);
}

await writeFile(path, source, "utf8");
