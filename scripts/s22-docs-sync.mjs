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
  const s21LastBullet =
    "- S21 unit and browser coverage for terminal reset, active reset, partial cleanup, replay safety, late image output, page restoration and immediate second capture on the same tab.";
  source = replaceUnique(
    source,
    s21LastBullet,
    `${s21LastBullet}\n- Region-selector ready handshake that closes the popup only after root attachment, listeners, focus, and first render; launch timeout and injection failure reuse the reset primitive and leave no orphan job, root, summary, or tab lease.\n- Accessible region creation and editing with pointer create/move/eight-handle resize, vertical and horizontal edge auto-scroll, 24 CSS-pixel handle targets, keyboard creation/movement/resizing/commit/cancel, and a toolbar kept above the selected rectangle.\n- Selector removal plus two animation frames before capture, duplicate-open instance reuse, DPR/zoom coordinate coverage, and browser validation for overlay exclusion and exact page restoration.`,
    "CHANGELOG S22 insertion",
  );
  await writeFile(path, source, "utf8");
}

async function updateReadme() {
  const path = "README.md";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    "**0.2.0 implementation is active. S21 capture reset is complete; S22 region-selector launch/reliability is next.** S21 adds a versioned reset domain command, owned-data cleanup, active-task quiescence, late-output protection and a visible “New capture” action without changing the 0.1.0 package boundary. S23–S26 remain planned for adaptive auto-scroll, mode-aware output, settings/events/UI and release hardening. “Capture to the end” removes the arbitrary 100,000 CSS-pixel stopping behavior for adaptive mode while retaining explicit time, storage, tile and memory safeguards for truly infinite or device-exhausting pages.",
    "**0.2.0 implementation is active. S21 capture reset and S22 region-selector reliability are complete; S23 adaptive auto-scroll is next.** S21 adds a versioned reset domain command, owned-data cleanup, active-task quiescence, late-output protection and a visible “New capture” action. S22 adds a focused ready handshake, pointer/keyboard region editing, two-axis auto-scroll, 24 CSS-pixel handles, duplicate-open safety and zero-orphan launch cleanup. S23–S26 remain planned for resumable adaptive capture, mode-aware output, settings/events/UI and release hardening. “Capture to the end” removes the arbitrary 100,000 CSS-pixel stopping behavior for adaptive mode while retaining explicit time, storage, tile and memory safeguards for truly infinite or device-exhausting pages.",
    "README current status",
  );
  await writeFile(path, source, "utf8");
}

async function updateSpec() {
  const path = "docs/spec-0.2.0.md";
  let source = await readFile(path, "utf8");
  const invariants =
    "## 3.4 Commit/cancel invariants\n\n- Region lưu bằng CSS document coordinates.\n- Root bị remove trước capture; chờ ít nhất hai RAF.\n- Overlay pixels không được xuất hiện trong tile.\n- Cancel/launch failure phục hồi original scroll/focus và xóa job khi chưa có tile.\n- Duplicate open cho cùng job trả cùng selector instance hoặc thay thế atomically; không có hai roots.";
  source = replaceUnique(
    source,
    `${invariants}\n\n# 4. Adaptive auto-scroll engine`,
    `${invariants}\n\n## 3.5 Locked S22 launch and interaction semantics\n\n- \`REGION_SELECTION_OPENED\` là ready acknowledgement, không phải message-received acknowledgement. Response chỉ được trả sau root attach, listener setup, dialog focus và first animation frame.\n- Background launch có timeout hai giây. Timeout, injection failure, malformed ACK hoặc job mismatch gọi S21 capture-reset primitive và xóa capture-owned data cùng exact tab lease.\n- Concurrent opens cho cùng job dùng chung một opening promise và một \`selectorInstanceId\`; job khác không được thay thế selector đang mở.\n- Selector hỗ trợ pointer create, frame move, eight-direction resize và edge auto-scroll theo cả hai trục. Toolbar có stacking layer cao hơn selection để control luôn thao tác được.\n- Keyboard deterministic: Space hoặc toolbar tạo centered rectangle; arrows move; Alt+arrows resize; Shift tăng bước lên 10 CSS px; Enter commit; Escape cancel. Handle hit target tối thiểu 24 CSS px.\n- Commit/cancel remove root và listener, phục hồi selector-owned state; commit chờ hai animation frame trước capture để UI selector không lọt vào output.\n\n# 4. Adaptive auto-scroll engine`,
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
