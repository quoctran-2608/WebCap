import { readFile, writeFile } from "node:fs/promises";

const path = "PLAN.md";
let source = await readFile(path, "utf8");

const replacements = [
  [
    "**Hoàn thành:** 2026-08-03 · PR #13 · final validation pending.",
    "**Hoàn thành:** 2026-08-03 · PR #13 · validation code head `547887d` · CI run `30787032374`.",
  ],
  [
    "CI đã xác nhận 159 unit tests và 8 Playwright E2E",
    "CI sạch đã xác nhận 160 unit tests và 8 Playwright E2E",
  ],
  [
    "| S09 | DONE | 2026-08-03 | PR #13 / final validation pending | format, lint, typecheck, 159 unit, build, 8 Playwright E2E |",
    "| S09 | DONE | 2026-08-03 | PR #13 / 547887d / CI 30787032374 | format, lint, typecheck, 160 unit, build, 8 Playwright E2E |",
  ],
];

for (const [before, after] of replacements) {
  if (!source.includes(before)) {
    if (!source.includes(after)) {
      throw new Error(`Expected PLAN.md pattern was not found: ${before}`);
    }
    continue;
  }
  source = source.replace(before, after);
}

await writeFile(path, source, "utf8");
