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
  ["current_session: S06", "current_session: S07"],
  [
    "| S06 | M2 | Persistent job state machine và repositories | S05 | 16k–24k | NEXT |",
    "| S06 | M2 | Persistent job state machine và repositories | S05 | 16k–24k | DONE |",
  ],
  [
    "| S07 | M2 | Debugger client, page metrics và 2D tile planner | S06 | 20k–28k | READY |",
    "| S07 | M2 | Debugger client, page metrics và 2D tile planner | S06 | 20k–28k | NEXT |",
  ],
  [
    "**Commit gợi ý:** `Add persistent capture job state machine`.\n\n---",
    "**Commit gợi ý:** `Add persistent capture job state machine`.\n\n**Hoàn thành:** 2026-08-02 · PR #10 · validation head `58fbc61`.\n\n**Ghi chú kỹ thuật:** full CaptureJob được lưu trong IndexedDB với compare-and-set `stateRevision`; `chrome.storage.session` chỉ giữ summary metadata và lease một job non-terminal cho mỗi tab. Coordinator khôi phục job sau service-worker restart, chuyển các bước đang chạy dở sang failed retryable sau cleanup, persist dedupe response cho JOB_CREATE/JOB_GET/JOB_CANCEL và dọn job/tile/artifact hết hạn mà không xóa job còn lease hợp lệ. CI sạch pass format, lint, strict typecheck, 110 unit tests, build và 2 Playwright visible-capture E2E.\n\n---",
  ],
  [
    "| S06 | NEXT | — | — | — | Sẵn sàng triển khai persistent job state machine và repositories. |",
    "| S06 | DONE | 2026-08-02 | PR #10 / 58fbc61 | format, lint, typecheck, 110 unit, build, 2 Playwright E2E | State transitions, CAS repository, per-tab lease, restart recovery, persistent dedupe và expiry cleanup đã được xác thực. |",
  ],
  [
    "| S07 | READY | — | — | — | — |",
    "| S07 | NEXT | — | — | — | Sẵn sàng triển khai debugger client, page metrics và 2D tile planner. |",
  ],
  [
    "Session kế tiếp là **S06 — Persistent job state machine và repositories**.",
    "Session kế tiếp là **S07 — Debugger client, page metrics và 2D tile planner**.",
  ],
  [
    "1. Đọc `PLAN.md` phần S06.\n2. Đọc SPEC domain/state/message/storage sections §7–12 và tests §27.\n3. Kiểm tra repo/branch và kết quả CI S05.\n4. Chỉ triển khai S06.\n5. Kết thúc với persistent state transitions, recovery summary, idempotent commands và repository tests đầy đủ.",
    "1. Đọc `PLAN.md` phần S07.\n2. Đọc SPEC debugger/metrics/tile sections §13–16, TV-01 và error model.\n3. Kiểm tra repo/branch và kết quả CI S06.\n4. Chỉ triển khai S07.\n5. Kết thúc với debugger attach/detach an toàn, normalized page metrics và 2D tile planner deterministic đầy đủ test.",
  ],
]);

await replaceExactlyOnce("README.md", [
  [
    "**S05 — The visible capture slice is complete.** WebCap now captures the active viewport, creates a local PNG/JPEG/WebP preview, restores that preview after the popup closes, and downloads the stored artifact without recapturing. Playwright validates the real unpacked extension at normal display settings and at DPR 2 with 125% zoom. The next session is S06 persistent capture jobs and repositories.",
    "**S06 — The persistent capture-job foundation is complete.** WebCap now stores full capture jobs and tile records in IndexedDB, keeps metadata-only recovery summaries and per-tab leases in `chrome.storage.session`, rejects stale state revisions, restores interrupted jobs after service-worker restart, and deduplicates persistent job commands by request ID. The next session is S07 debugger metrics and deterministic 2D tile planning.",
  ],
  [
    "src/shared/contracts/   Typed cross-context message envelopes.\ntests/unit/",
    "src/shared/contracts/   Typed cross-context message envelopes.\nsrc/storage/            IndexedDB and chrome.storage repositories.\ntests/unit/",
  ],
  [
    "tests/smoke/            Real-Chrome unpacked-extension smoke tests.",
    "tests/e2e/              Playwright unpacked-extension integration tests.\ntests/smoke/            Real-Chrome unpacked-extension smoke tests.",
  ],
]);

await replaceExactlyOnce("CHANGELOG.md", [
  [
    "### Added\n\n",
    "### Added\n\n- Persistent capture-job state machine with guarded transitions, invariants, and optimistic `stateRevision` compare-and-set writes.\n- Versioned IndexedDB job, tile, artifact-cleanup, and request-dedupe repositories with normalized transaction failures.\n- Metadata-only job summaries and per-tab leases in `chrome.storage.session`, including service-worker restart recovery.\n- Idempotent `JOB_CREATE`, `JOB_GET`, and `JOB_CANCEL` contracts plus expiry cleanup that preserves actively leased jobs.\n",
  ],
]);

const manualPath = "docs/manual-testing.md";
const manual = await readFile(manualPath, "utf8");
const heading = "## S06 persistent job storage inspection";
if (manual.includes(heading)) {
  throw new Error(`${manualPath}: S06 section already exists`);
}
const addition = `

${heading}

S06 is an infrastructure milestone and does not expose full-page controls yet. After loading \`dist/\`, inspect the extension service worker in Chrome DevTools while exercising a typed \`JOB_CREATE\`, \`JOB_GET\`, or \`JOB_CANCEL\` message from an extension context:

1. Confirm IndexedDB \`webcap-db\` stores the complete record in \`jobs\` and any future binary tile payload only in \`tiles\`.
2. Confirm \`chrome.storage.session["webcap.jobs.session"]\` contains summaries and tab leases only; it must not contain settings, tile plans, page content, or Blob/base64 image data.
3. Re-send the same command with the same \`requestId\`; the response must be identical and no duplicate job may be created.
4. Reload the unpacked extension while a simulated job is in \`preparing\`, \`capturing\`, \`processing\`, or \`exporting\`; initialization must settle cleanup and restore it as retryable \`failed\` rather than silently resuming unsafe browser work.
5. Verify an unexpired per-tab lease blocks a second non-terminal job, while an expired lease can be replaced.
6. Verify expiry cleanup removes job, tile, artifact, summary, and lock records but skips a job whose lease is still valid.

The deterministic S06 behavior is covered by \`pnpm test:unit\`; existing \`pnpm test:e2e\` remains the regression gate for the completed visible-capture slice.
`;
await writeFile(manualPath, `${manual.trimEnd()}${addition}\n`, "utf8");
