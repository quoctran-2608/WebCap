import { readFile, writeFile } from "node:fs/promises";

function replaceUnique(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`S22 docs anchor is missing or not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

async function updatePlan() {
  const path = "PLAN.md";
  let source = await readFile(path, "utf8");
  source = replaceUnique(source, "current_session: S22", "current_session: S23", "PLAN current session");
  source = replaceUnique(
    source,
    "S21 triển khai reset/chụp mới mà không thay manifest, package version hoặc artifact 0.1.0. S22 là session active tiếp theo.",
    "S21–S22 đã hoàn tất reset lifecycle và region selector đáng tin cậy mà không thay manifest, package version hoặc artifact 0.1.0. S23 là session active tiếp theo.",
    "PLAN introduction",
  );
  source = replaceUnique(
    source,
    "| S22 | Region drawing launch, interaction và accessibility | PLANNED | S21 cleanup primitive |",
    "| S22 | Region drawing launch, interaction và accessibility | DONE | S21 cleanup primitive |",
    "PLAN S22 status",
  );
  source = replaceUnique(
    source,
    "| S23 | Adaptive auto-scroll và resumable frontier | BLOCKED | S21 |",
    "| S23 | Adaptive auto-scroll và resumable frontier | PLANNED | S21–S22 |",
    "PLAN S23 status",
  );
  source = replaceUnique(
    source,
    "## Exit\n\n- AC-31–AC-34 pass.\n- User không cần click ra ngoài popup hoặc đoán bước tiếp theo.\n- No orphan selector/job.\n\n# 7. S23 — Adaptive auto-scroll và resumable frontier",
    "## Exit\n\n- AC-31–AC-34 pass.\n- User không cần click ra ngoài popup hoặc đoán bước tiếp theo.\n- No orphan selector/job.\n\n## S22 implementation evidence\n\n- Ready ACK chỉ được trả sau root attach, listener setup, dialog focus và first render.\n- Popup chỉ đóng sau ACK; timeout/injection failure đi qua S21 reset và để lại zero orphan job/root/lease.\n- Pointer create/move/eight-handle resize, two-axis edge auto-scroll và toolbar luôn tương tác được trên selection.\n- Keyboard Space/toolbar create, arrows move, Alt resize, Shift acceleration, Enter commit và Escape cancel.\n- Handle hit target tối thiểu 24 CSS px; selector bị remove và chờ hai animation frame trước capture.\n- Final gate: formatting, ESLint, strict TypeScript, audits, 295/295 unit tests trên 84 files, 4/4 PDF benchmarks, verified build, reproducible ZIP, 44/44 Playwright E2E và packaged lifecycle smoke đều PASS.\n\n# 7. S23 — Adaptive auto-scroll và resumable frontier",
    "PLAN S22 evidence",
  );
  const handoff = "# 13. Current session handoff";
  const handoffIndex = source.indexOf(handoff);
  if (handoffIndex < 0) throw new Error("PLAN handoff section is missing.");
  source = `${source.slice(0, handoffIndex)}${handoff}\n\n**Current session: S23 — Adaptive auto-scroll và resumable frontier.**\n\n1. Bắt đầu từ baseline S22 đã merge.\n2. Viết frontier/stable-end contracts và persistence trước engine/UI.\n3. Kiểm thử actual-browser 30k/100k/>100k, finite lazy growth, infinite guard và worker restart.\n4. Giữ nguyên S21 cleanup và S22 selector semantics.\n5. Không kéo S24 output routing hoặc S25 popup redesign vào scope S23.\n`;
  await writeFile(path, source, "utf8");
}

async function updateChangelog() {
  const path = "CHANGELOG.md";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    "## [Unreleased]\n\nNo unreleased changes.",
    `## [Unreleased]\n\n### Added\n\n- Versioned capture-reset lifecycle with ownership-safe cleanup, active cancellation ordering, idempotent replay, late-output race protection, and terminal/active “Chụp mới” actions.\n- Region-selector ready handshake that closes the popup only after root attachment, listeners, focus, and first render; launch timeout and injection failure reuse the reset primitive and leave no orphan job, root, summary, or tab lease.\n- Accessible region creation and editing with pointer create/move/eight-handle resize, vertical and horizontal edge auto-scroll, 24 CSS-pixel handle targets, keyboard creation/movement/resizing/commit/cancel, and a toolbar kept above the selected rectangle.\n- Selector removal plus two animation frames before capture, duplicate-open instance reuse, DPR/zoom coordinate coverage, and browser validation for overlay exclusion and exact page restoration.`,
    "CHANGELOG Unreleased",
  );
  await writeFile(path, source, "utf8");
}

async function updateReadme() {
  const path = "README.md";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    "WebCap is a local-first Chrome extension for visible viewport capture, CDP-first or scroll-fallback full-page capture, rectangular region capture, DOM element capture, full scrollable-area capture, local image export, page-at-a-time PDF creation, non-destructive PDF editing, and original-PDF passthrough when Chrome can safely expose the source bytes.",
    "WebCap is a local-first Chrome extension for visible viewport capture, CDP-first or scroll-fallback full-page capture, reliable rectangular region capture with pointer/keyboard editing and two-axis auto-scroll, DOM element capture, full scrollable-area capture, local image export, page-at-a-time PDF creation, non-destructive PDF editing, and original-PDF passthrough when Chrome can safely expose the source bytes.",
    "README overview",
  );
  await writeFile(path, source, "utf8");
}

async function updateSpec() {
  const path = "docs/spec-0.2.0.md";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    "### 3.4 Restore and capture\n\nBefore capture:\n\n1. Remove selector root.\n2. Wait two animation frames.\n3. Revalidate document rectangle.\n4. Start capture.\n\n# 4. Adaptive auto-scroll",
    `### 3.4 Restore and capture\n\nBefore capture:\n\n1. Remove selector root.\n2. Wait two animation frames.\n3. Revalidate document rectangle.\n4. Start capture.\n\n### 3.5 Locked S22 launch and interaction semantics\n\n- \`REGION_SELECTION_OPENED\` is a ready acknowledgement, not a message-received acknowledgement. It is emitted only after the root is attached, listeners are installed, the dialog owns focus, and the first animation frame has rendered.\n- Background launch uses a two-second bound. Timeout, injection failure, malformed ACK, or job mismatch calls the S21 capture-reset primitive and deletes capture-owned data and the exact tab lease.\n- Concurrent opens for the same job share one opening promise and one \`selectorInstanceId\`; an already-open different job is rejected.\n- The selector supports pointer creation, frame movement, eight-direction resize, and edge auto-scroll on both axes. The floating toolbar has a higher stacking layer than the selection so controls remain operable.\n- Keyboard support is deterministic: Space or toolbar creates a centered rectangle, arrows move, Alt+arrows resize, Shift accelerates by 10 CSS px, Enter commits, and Escape cancels. Resize-handle hit targets are at least 24 CSS px.\n- Commit and cancel remove the root and listeners and restore selector-owned state. Commit waits two animation frames before capture so selector pixels cannot enter the result.\n\n# 4. Adaptive auto-scroll`,
    "SPEC S22 semantics",
  );
  await writeFile(path, source, "utf8");
}

async function updateManualTesting() {
  const path = "docs/manual-testing.md";
  let source = await readFile(path, "utf8");
  if (!source.includes("## S22 — Reliable region selector")) {
    source += `\n\n## S22 — Reliable region selector\n\n1. Open a normal long page, choose **Vùng tự chọn**, and start selection. Confirm the popup closes only after the dim mask, crosshair, toolbar, and focused dialog are visible.\n2. Trigger two duplicate open messages for the same job. Confirm there is one selector root and both ACKs return the same selector-instance ID.\n3. Create a rectangle with the pointer; move it and resize all eight handles. Confirm every handle remains easy to hit and the toolbar stays clickable above the rectangle.\n4. Hold the pointer near the bottom and right edges on a tall/wide page. Confirm vertical and horizontal auto-scroll extend the document rectangle; Escape restores both scroll axes and focus.\n5. Create with Space or the toolbar. Verify arrows move, Shift+arrows move 10 px, Alt+arrows resize, Enter commits, and Escape cancels.\n6. Repeat at DPR 2 and 125% zoom. Compare the displayed CSS document rectangle with the persisted target rectangle.\n7. Force selector injection against a missing tab. Confirm the popup receives an error and IndexedDB/session storage contain zero orphan region jobs, summaries, tiles, selector roots, or tab leases.\n8. Capture a region and inspect the first pixels. Confirm the dim mask, crosshair, toolbar, handles, and labels are absent from the output.\n`;
  }
  await writeFile(path, source, "utf8");
}

async function updateSessionEvidence() {
  const path = "docs/sessions/s22-region-selector.md";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    "Status: IMPLEMENTED, final repository gate pending",
    "Status: DONE pending merge of PR #27",
    "S22 session status",
  );
  source = replaceUnique(
    source,
    "- Formatting, ESLint, strict TypeScript, unit tests, and production build: PASS before the full repository gate.\n- Unit coverage includes contracts, readiness timeout, keyboard geometry, duplicate responses, and S21 reset routing on launch failure.\n- Browser coverage includes popup-close ordering, focused readiness, duplicate opens, pointer and keyboard flows, 24-pixel handles, vertical and horizontal auto-scroll, DPR/zoom stability, overlay exclusion, page restoration, and zero-orphan launch failure.\n- Full audits, PDF benchmarks, reproducible package, complete E2E, and packaged lifecycle remain the final merge gate.",
    "- Formatting, ESLint, strict TypeScript, privacy/dependency/release/critical-security audits, and production build: PASS.\n- Unit: 295/295 across 84 files, including contracts, readiness timeout, keyboard geometry, duplicate responses, and S21 reset routing on launch failure.\n- PDF benchmark: 4/4 scenarios; reproducible release ZIP: PASS.\n- Browser: 44/44 Playwright E2E, including popup-close ordering, focused readiness, duplicate opens, pointer and keyboard flows, 24-pixel handles, two-axis auto-scroll, DPR/zoom stability, overlay exclusion, page restoration, and zero-orphan launch failure.\n- Packaged install/update/storage-retention/uninstall lifecycle smoke: PASS.",
    "S22 final evidence",
  );
  await writeFile(path, source, "utf8");
}

await updatePlan();
await updateChangelog();
await updateReadme();
await updateSpec();
await updateManualTesting();
await updateSessionEvidence();
