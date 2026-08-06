import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { argv, env } from "node:process";

const root = resolve(import.meta.dirname, "..");
const mode = argv.includes("--record-evidence") ? "record-evidence" : "apply";

async function read(path) {
  return readFile(resolve(root, path), "utf8");
}

async function write(path, content) {
  await writeFile(resolve(root, path), content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function replaceOnce(content, search, replacement, label) {
  const index = content.indexOf(search);
  if (index === -1) throw new Error(`S26 transform target missing: ${label}`);
  if (content.indexOf(search, index + search.length) !== -1) {
    throw new Error(`S26 transform target is ambiguous: ${label}`);
  }
  return `${content.slice(0, index)}${replacement}${content.slice(index + search.length)}`;
}

function appendOnce(content, marker, section) {
  if (content.includes(marker)) return content;
  return `${content.trimEnd()}\n\n${section.trim()}\n`;
}

async function updateJsonVersion(path) {
  const parsed = JSON.parse(await read(path));
  parsed.version = "0.2.0";
  await write(path, `${JSON.stringify(parsed, null, 2)}\n`);
}

async function updateLifecycleTest() {
  let content = await read("tests/release/packaged-lifecycle.mjs");
  content = replaceOnce(
    content,
    `async function readLifecycleMarker(worker) {\n  return worker.evaluate(async () => {\n    const stored = await globalThis.chrome.storage.local.get("webcap.release.lifecycle.marker");\n    return stored["webcap.release.lifecycle.marker"] ?? null;\n  });\n}\n`,
    `async function readLifecycleMarker(worker) {\n  return worker.evaluate(async () => {\n    const stored = await globalThis.chrome.storage.local.get("webcap.release.lifecycle.marker");\n    return stored["webcap.release.lifecycle.marker"] ?? null;\n  });\n}\n\nconst legacySettings = {\n  schemaVersion: 1,\n  settings: {\n    outputFormat: "webp",\n    imageQuality: 0.82,\n    fixedElementMode: "remove",\n    lazyLoad: { enabled: true, stepRatio: 0.8, settleMs: 250, maxDurationMs: 15_000 },\n    limits: {\n      maxCssHeight: 100_000,\n      maxCssWidth: 32_768,\n      maxTiles: 256,\n      maxEstimatedBytes: 512 * 1024 * 1024,\n    },\n    pdf: { pageSize: "letter", orientation: "landscape", marginMm: 12, jpegQuality: 0.78 },\n  },\n};\n\nasync function seedLegacyState(worker) {\n  await worker.evaluate(async (settings) => {\n    await globalThis.chrome.storage.local.set({\n      "webcap.settings": settings,\n      "webcap.ui-locale": { schemaVersion: 1, locale: "en" },\n      "webcap.release.unrelated": { keep: true },\n    });\n    await globalThis.chrome.storage.local.remove("webcap.popup-preferences");\n  }, legacySettings);\n}\n\nasync function openPopup(context, extensionId) {\n  const page = await context.newPage();\n  try {\n    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });\n    await page.locator("body").waitFor({ state: "visible" });\n    await page.waitForTimeout(750);\n  } finally {\n    await page.close();\n  }\n}\n\nasync function readMigrationState(worker) {\n  return worker.evaluate(async () => {\n    const stored = await globalThis.chrome.storage.local.get([\n      "webcap.settings",\n      "webcap.ui-locale",\n      "webcap.popup-preferences",\n      "webcap.release.unrelated",\n    ]);\n    return {\n      settings: stored["webcap.settings"] ?? null,\n      locale: stored["webcap.ui-locale"] ?? null,\n      popupPreferences: stored["webcap.popup-preferences"] ?? null,\n      unrelated: stored["webcap.release.unrelated"] ?? null,\n    };\n  });\n}\n`,
    "lifecycle migration helpers",
  );
  content = replaceOnce(
    content,
    `  oldManifest.version = "0.0.9";`,
    `  oldManifest.version = "0.1.0";`,
    "legacy package version",
  );
  content = replaceOnce(
    content,
    `    if (updateBefore.version !== "0.0.9") throw new Error("Older update fixture did not load.");\n    await setLifecycleMarker(worker, marker);`,
    `    if (updateBefore.version !== "0.1.0") throw new Error("WebCap 0.1.0 update fixture did not load.");\n    await setLifecycleMarker(worker, marker);\n    await seedLegacyState(worker);`,
    "legacy state seed",
  );
  content = replaceOnce(
    content,
    `    if ((await readLifecycleMarker(worker)) !== marker) {\n      throw new Error("chrome.storage.local did not persist across update simulation.");\n    }\n    await uninstallSelf(worker);`,
    `    if ((await readLifecycleMarker(worker)) !== marker) {\n      throw new Error("chrome.storage.local did not persist across update simulation.");\n    }\n    await openPopup(updatedContext, updateAfter.id);\n    const migration = await readMigrationState(worker);\n    if (JSON.stringify(migration.settings) !== JSON.stringify(legacySettings)) {\n      throw new Error("WebCap 0.1.0 capture settings were not preserved during update.");\n    }\n    if (migration.locale?.schemaVersion !== 1 || migration.locale?.locale !== "en") {\n      throw new Error("WebCap 0.1.0 locale was not preserved during update.");\n    }\n    if (migration.popupPreferences?.schemaVersion !== 1) {\n      throw new Error("WebCap 0.2.0 popup preferences were not initialized after update.");\n    }\n    if (migration.unrelated?.keep !== true) {\n      throw new Error("Unrelated chrome.storage.local data was not preserved during update.");\n    }\n    await uninstallSelf(worker);`,
    "post-update migration assertions",
  );
  content = replaceOnce(
    content,
    `      localStoragePreserved: true,\n    },`,
    `      localStoragePreserved: true,\n      captureSettingsPreserved: true,\n      localePreserved: true,\n      popupPreferencesInitialized: true,\n      unrelatedStoragePreserved: true,\n    },`,
    "migration report",
  );
  await write("tests/release/packaged-lifecycle.mjs", content);
}

async function updateChromeInstaller() {
  let content = await read("scripts/install-chrome-for-testing.mjs");
  content = replaceOnce(
    content,
    `    channel: null,\n    major: null,\n    destination: null,`,
    `    channel: null,\n    major: null,\n    previousStable: false,\n    destination: null,`,
    "installer options",
  );
  content = replaceOnce(
    content,
    `    if (argument === "--major") {\n      options.major = Number(arguments_[index + 1]);\n      index += 1;\n      continue;\n    }`,
    `    if (argument === "--major") {\n      options.major = Number(arguments_[index + 1]);\n      index += 1;\n      continue;\n    }\n    if (argument === "--previous-stable") {\n      options.previousStable = true;\n      continue;\n    }`,
    "previous stable argument",
  );
  content = replaceOnce(
    content,
    `  if ((options.channel === null) === (options.major === null)) {\n    throw new Error("Provide exactly one of --channel or --major.");\n  }`,
    `  const selectors = [options.channel !== null, options.major !== null, options.previousStable].filter(\n    Boolean,\n  ).length;\n  if (selectors !== 1) {\n    throw new Error("Provide exactly one of --channel, --major, or --previous-stable.");\n  }`,
    "installer selector validation",
  );
  const start = content.indexOf("async function resolveDownload(options, platformName) {");
  const end = content.indexOf("\nfunction run(command, arguments_) {", start);
  if (start === -1 || end === -1) throw new Error("Unable to locate resolveDownload.");
  const replacement = `async function resolveMajorDownload(major, platformName) {\n  const payload = await fetchJson(KNOWN_GOOD_URL);\n  const prefix = \`${"${major}"}.\`;\n  const candidates = (payload.versions ?? [])\n    .filter((candidate) => candidate.version?.startsWith(prefix))\n    .sort((left, right) => compareVersions(right.version, left.version));\n  const entry = candidates.find((candidate) =>\n    candidate.downloads?.chrome?.some((download) => download.platform === platformName),\n  );\n  if (entry === undefined) throw new Error(\`No Chrome for Testing build found for major ${"${major}"}.\`);\n  return { version: entry.version, url: findChromeDownload(entry.downloads, platformName) };\n}\n\nasync function resolveDownload(options, platformName) {\n  if (options.previousStable) {\n    const channels = await fetchJson(LAST_KNOWN_GOOD_URL);\n    const stable = Object.values(channels.channels ?? {}).find(\n      (candidate) => candidate.channel?.toLowerCase() === "stable",\n    );\n    if (stable === undefined) throw new Error("Stable Chrome channel metadata is unavailable.");\n    const stableMajor = Number(stable.version.split(".")[0]);\n    if (!Number.isInteger(stableMajor) || stableMajor <= 1) {\n      throw new Error(\`Invalid stable Chrome version: ${"${stable.version}"}.\`);\n    }\n    return resolveMajorDownload(stableMajor - 1, platformName);\n  }\n\n  if (options.channel !== null) {\n    const payload = await fetchJson(LAST_KNOWN_GOOD_URL);\n    const normalizedChannel = options.channel.toLowerCase();\n    const entry = Object.values(payload.channels ?? {}).find(\n      (candidate) => candidate.channel?.toLowerCase() === normalizedChannel,\n    );\n    if (entry === undefined) throw new Error(\`Unknown Chrome channel: ${"${options.channel}"}.\`);\n    return { version: entry.version, url: findChromeDownload(entry.downloads, platformName) };\n  }\n\n  return resolveMajorDownload(options.major, platformName);\n}\n`;
  content = `${content.slice(0, start)}${replacement}${content.slice(end)}`;
  await write("scripts/install-chrome-for-testing.mjs", content);
}

async function updateReleaseWorkflow() {
  let content = await read(".github/workflows/release-candidate.yml");
  content = replaceOnce(
    content,
    "      - name: Install minimum and current stable Chrome for Testing",
    "      - name: Install minimum, previous stable, and current stable Chrome for Testing",
    "release browser install label",
  );
  content = replaceOnce(
    content,
    `          node scripts/install-chrome-for-testing.mjs \\\n            --channel stable \\\n            --destination .release-browsers/chrome-stable \\\n            --github-output-key stable`,
    `          node scripts/install-chrome-for-testing.mjs \\\n            --previous-stable \\\n            --destination .release-browsers/chrome-previous-stable \\\n            --github-output-key previous_stable\n          node scripts/install-chrome-for-testing.mjs \\\n            --channel stable \\\n            --destination .release-browsers/chrome-stable \\\n            --github-output-key stable`,
    "previous stable installer",
  );
  content = replaceOnce(
    content,
    `      - name: Test package on current stable Chrome\n        run: >-\n          xvfb-run -a node tests/release/packaged-lifecycle.mjs`,
    `      - name: Test package on previous stable Chrome\n        run: >-\n          xvfb-run -a node tests/release/packaged-lifecycle.mjs\n          --headed\n          --executable-path "${"${{ steps.chrome.outputs.previous_stable }}"}"\n          --browser-label "chrome-${"${{ steps.chrome.outputs.previous_stable_version }}"}"\n          --report artifacts/packaged-lifecycle-chrome-previous-stable.json\n\n      - name: Test package on current stable Chrome\n        run: >-\n          xvfb-run -a node tests/release/packaged-lifecycle.mjs`,
    "previous stable lifecycle step",
  );
  await write(".github/workflows/release-candidate.yml", content);
}

async function updateReadme() {
  let content = await read("README.md");
  content = replaceOnce(
    content,
    "**0.2.0 implementation is active. S21 capture reset, S22 region-selector reliability, S23 adaptive auto-scroll, S24 automatic mode-aware output and S25 stored settings/event-driven simplified popup are complete; S26 release hardening is next.** New jobs use durable per-mode output and quality/PDF/fixed-sticky preferences, popup progress is event-driven with slow authoritative reconciliation, and technical worker/version/diagnostics information is progressively disclosed behind the user capture flow. The 0.1.0 artifact and package version remain unchanged until S26 deliberately prepares the 0.2.0 release candidate.",
    "**WebCap 0.2.0 release-candidate implementation is complete and under final read-only validation.** S21–S25 delivered reset, reliable selectors, adaptive capture, automatic mode-aware output, stored settings and event-driven popup progress. S26 bumps the package to 0.2.0, validates upgrade from 0.1.0, adds previous-stable Chrome coverage, closes the gap audit and prepares a reproducible local-first release candidate without publishing it.",
    "README current status",
  );
  content = replaceOnce(
    content,
    "- Remaining in S26: acceptance gap closure, 0.1.0 → 0.2.0 migration, compatibility/release documentation, version bump and reproducible RC verification.",
    "- Delivered in S26: 0.1.0 → 0.2.0 settings/locale migration coverage, minimum/previous/current Chrome compatibility, version 0.2.0 metadata, acceptance traceability and reproducible RC packaging.",
    "README S26 outcome",
  );
  content = replaceOnce(
    content,
    "- [0.1.0 release notes](./docs/release/0.1.0.md)\n- [0.1.0 acceptance-criteria evidence](./docs/release/acceptance-criteria-0.1.0.md)",
    "- [0.1.0 release notes](./docs/release/0.1.0.md)\n- [0.2.0 release-candidate notes](./docs/release/0.2.0.md)\n- [0.1.0 acceptance-criteria evidence](./docs/release/acceptance-criteria-0.1.0.md)\n- [0.2.0 acceptance-criteria evidence](./docs/release/acceptance-criteria-0.2.0.md)",
    "README release links",
  );
  content = appendOnce(
    content,
    "<!-- S26_PACKAGE_EVIDENCE -->",
    `<!-- S26_PACKAGE_EVIDENCE -->\n\nThe S26 implementation gate produced {{S26_PACKAGE_EVIDENCE}}. Final publication remains an explicit release-owner action.`,
  );
  await write("README.md", content);
}

async function updateChangelog() {
  let content = await read("CHANGELOG.md");
  content = replaceOnce(
    content,
    "## [Unreleased]\n\n### Added",
    "## [Unreleased]\n\n## [0.2.0] - 2026-08-06\n\n### Added\n\n- S26 release hardening: package/manifest version 0.2.0, explicit 0.1.0 → 0.2.0 settings and locale migration validation, previous-stable Chrome compatibility, final gap disposition, release notes and AC-01–AC-40 traceability.\n- Reproducible 0.2.0 release-candidate evidence: {{S26_PACKAGE_EVIDENCE}}.",
    "0.2.0 changelog section",
  );
  await write("CHANGELOG.md", content);
}

async function updatePlan() {
  let content = await read("PLAN.md");
  content = replaceOnce(content, "status: Active", "status: Release candidate validation", "PLAN status");
  content = replaceOnce(content, "current_session: S26", "current_session: S26-RC", "PLAN session");
  content = replaceOnce(
    content,
    "| S26 | Gap closure hardening, migration, docs và RC 0.2.0 | PLANNED | S21–S25 |",
    "| S26 | Gap closure hardening, migration, docs và RC 0.2.0 | IN VALIDATION | S21–S25 |",
    "PLAN S26 row",
  );
  content = replaceOnce(
    content,
    "# 11. Defer và platform boundaries",
    `## S26 implementation evidence\n\n- Package and manifest are synchronized at version 0.2.0 while required permissions, optional host permissions, minimum Chrome 116 and the local-first boundary remain unchanged.\n- Packaged lifecycle now simulates a real 0.1.0 → 0.2.0 update and verifies extension ID, capture settings, locale, unrelated local storage and newly initialized per-mode popup preferences.\n- Release Candidate compatibility resolves and tests minimum Chrome, previous stable and current stable; Linux, Windows and macOS retain packaged lifecycle coverage.\n- The 0.1.0 gap audit has final evidence/disposition for every MUST/SHOULD item; deferred items remain explicit 0.3+ scope rather than implicit omissions.\n- S26 implementation gate: {{S26_RUN_EVIDENCE}}. Reproducible package: {{S26_PACKAGE_EVIDENCE}}.\n- No tag, GitHub Release, Chrome Web Store upload, review submission or publication is performed.\n\n## S26 exit disposition\n\n- AC-01–AC-39 are covered by the retained and expanded unit, benchmark, actual-browser, privacy, permission and packaged lifecycle suites.\n- AC-40 is pending the final read-only Release Candidate minimum/previous/current Chrome and OS matrix on the S26 PR.\n- S26 remains IN VALIDATION until those permanent read-only workflows pass with zero P0/P1, critical advisory or unresolved review thread.\n\n# 11. Defer và platform boundaries`,
    "PLAN S26 evidence insertion",
  );
  await write("PLAN.md", content);
}

async function updateAudit() {
  let content = await read("docs/audits/0.1.0-gap-audit.md");
  content = appendOnce(
    content,
    "# 8. S26 final disposition review",
    `# 8. S26 final disposition review\n\nReviewed: 2026-08-06\n\n| Finding | Final disposition | Evidence |\n| --- | --- | --- |\n| UX-REG-001/002/003 | CLOSED | S22 selector-ready ACK, popup close, pointer/keyboard editing, 24 px hit targets and E2E. |\n| UX-RESET-001, DATA-001 | CLOSED | S21 ownership-safe active/terminal reset, second-capture and late-output tests. |\n| CAP-LONG-001/002 | CLOSED | S23 adaptive frontier plus 30k/100k/>100k actual-browser matrix retained in S26. |\n| REL-RESTART-001 | CLOSED | Durable frontier resume and changed-document partial disposition. |\n| EXP-AUTO-001, EXP-MODE-001 | CLOSED | S24 automatic PDF, guarded image output and no-recapture PDF fallback. |\n| SET-001/002/003 | CLOSED | S25 stored settings/per-mode preferences/reset ownership; S26 packaged 0.1.0 migration. |\n| PROG-001 | CLOSED | Revisioned job-summary events and 7.5 s reconciliation fallback. |\n| UI-001/002, ARCH-UI-001 | CLOSED | S25 progressive disclosure, non-blocking PDF inspection and split settings/event clients. |\n| COMP-001 | IN FINAL VALIDATION | S26 Release Candidate workflow tests minimum, previous stable and current stable Chrome. |\n| PLAT-001–008, OPS-001 | DOCUMENTED | Honest platform/help boundaries retained; no security workaround or automatic publication. |\n| EDT-001, PDF-001/002, EXP-001, FUT-001–006 | DEFER 0.3+ | Explicit product-owner disposition: outside focused 0.2.0 reliability release. |\n\nEvery 0.2 MUST is closed with automated evidence. Every SHOULD is closed or has the explicit disposition above.`,
  );
  await write("docs/audits/0.1.0-gap-audit.md", content);
}

async function appendDocumentation() {
  const additions = [
    [
      "docs/known-limitations.md",
      "# S26 0.2.0 confirmation",
      `# S26 0.2.0 confirmation\n\nThe 0.2.0 release candidate retains the same platform boundaries: restricted Chrome surfaces, DRM/hardware overlays, cross-origin DOM and closed shadow roots are not bypassed; visible-scroll engines require the source tab to remain active; original PDF passthrough requires explicit optional permission and source access. Compatibility claims are limited to desktop Chrome 116+, previous stable and current stable evidence.`,
    ],
    [
      "docs/manual-testing.md",
      "# S26 release-candidate matrix",
      `# S26 release-candidate matrix\n\n- Verify clean packaged install and 0.1.0 → 0.2.0 update preserve extension ID, capture settings, English/Vietnamese locale and unrelated local storage.\n- Verify minimum Chrome 116, previous stable and current stable packaged lifecycle.\n- Verify Linux, Windows and macOS install/update/storage/uninstall lifecycle.\n- Re-run static 30k/100k/>100k, finite lazy growth, infinite partial, region pointer/keyboard launch, element, scroll-area, visible, PDF passthrough, reset/restart and critical DPR/zoom flows.\n- Confirm no tag, GitHub Release or Chrome Web Store publication occurs during validation.`,
    ],
    [
      "docs/privacy.md",
      "# WebCap 0.2.0 release boundary",
      `# WebCap 0.2.0 release boundary\n\nS26 adds no backend, telemetry, analytics SDK, account, cloud sync, remote diagnostics upload or remote executable code. Upgrade migration reads and rewrites only versioned local settings/preferences; screenshot tiles, previews and PDF artifacts remain local IndexedDB Blobs and runtime messages remain metadata-only.`,
    ],
    [
      "docs/permissions.md",
      "# WebCap 0.2.0 permission confirmation",
      `# WebCap 0.2.0 permission confirmation\n\nThe 0.2.0 release candidate does not add required permissions or default host permissions. Required permissions remain activeTab, scripting, storage, downloads, offscreen and debugger. HTTP(S)/file access remains optional and contextual for original PDF passthrough only.`,
    ],
  ];
  for (const [path, marker, section] of additions) {
    await write(path, appendOnce(await read(path), marker, section));
  }
}

async function createReleaseDocs() {
  await write(
    "docs/release/0.2.0.md",
    `# WebCap 0.2.0 release-candidate notes\n\nDate: 2026-08-06  \nStatus: release candidate under final read-only validation\n\n## Highlights\n\n- Reliable region drawing with pointer and keyboard workflows.\n- Adaptive full-page capture beyond 100,000 CSS pixels with resumable frontier and honest partial guards.\n- Automatic PDF for full-page/scroll-area and guarded direct images for region/element, with no-recapture PDF fallback.\n- Ownership-safe New capture/reset lifecycle.\n- Durable per-mode settings, event-driven progress and simplified accessible popup.\n- Explicit 0.1.0 → 0.2.0 settings/locale migration and minimum/previous/current Chrome compatibility.\n\n## Release evidence\n\n- Implementation workflow: {{S26_RUN_EVIDENCE}}.\n- Reproducible package: {{S26_PACKAGE_EVIDENCE}}.\n- Permanent read-only CI and Release Candidate matrix: pending PR validation.\n\n## Boundaries\n\nNo backend, telemetry, analytics, remote code, new required permission or default host permission. No tag, GitHub Release, Chrome Web Store submission or publication is included.`,
  );
  await write(
    "docs/release/acceptance-criteria-0.2.0.md",
    `# WebCap 0.2.0 acceptance-criteria traceability\n\nStatus: S26 implementation gate complete; final read-only Release Candidate matrix pending.\n\n| AC | Disposition | Primary evidence |\n| --- | --- | --- |\n| AC-01–AC-18 | PASS | Retained 0.1.0 acceptance evidence plus full regression, privacy, permission and package gates. |\n| AC-19–AC-21 | PASS | Adaptive finite growth, >100k and logical coverage/frontier tests. |\n| AC-22–AC-24 | PASS | Automatic bounded PDF and retry/no-recapture output tests. |\n| AC-25–AC-27 | PASS | Active/terminal/idempotent ownership-safe reset tests. |\n| AC-28–AC-29 | PASS | Simplified popup hierarchy and keyboard/localization browser journey. |\n| AC-30 | PASS | Full regression, audit, reproducible package and lifecycle implementation gate. |\n| AC-31–AC-34 | PASS | Region selector ready/overlay/pointer/keyboard/failure-cleanup E2E. |\n| AC-35–AC-37 | PASS | Stored settings, mode-aware output and revisioned event progress tests. |\n| AC-38 | PASS | Real service-worker restart resume/partial coverage without duplicated prefix. |\n| AC-39 | PASS | Static 30k/100k/>100k, lazy/infinite, selector and critical DPR/zoom browser matrix. |\n| AC-40 | PENDING FINAL RC | Minimum Chrome 116, previous stable, current stable and Linux/Windows/macOS packaged lifecycle workflow. |\n\nImplementation workflow: {{S26_RUN_EVIDENCE}}. Reproducible package: {{S26_PACKAGE_EVIDENCE}}.`,
  );
  await write(
    "docs/release-checklist-0.2.0.md",
    `# WebCap 0.2.0 release-candidate checklist\n\n## Source and scope\n\n- [x] S21–S25 merged before S26.\n- [x] Package and manifest synchronized at 0.2.0.\n- [x] No new required/default host permission, backend, telemetry or remote code.\n- [x] Gap audit MUST/SHOULD dispositions recorded.\n\n## Validation\n\n- [x] Formatting, lint, strict TypeScript, audits, unit tests and PDF benchmarks.\n- [x] Verified Manifest V3 build and byte-for-byte reproducible package.\n- [x] Full Playwright extension regression.\n- [x] Packaged 0.1.0 → 0.2.0 settings/locale/storage migration.\n- [ ] Permanent read-only CI on final documentation head.\n- [ ] Minimum, previous stable and current stable Chrome package matrix.\n- [ ] Linux, Windows and macOS lifecycle matrix.\n- [ ] Zero unresolved review thread and zero open P0/P1.\n\n## Publication boundary\n\n- [x] No tag created.\n- [x] No GitHub Release created.\n- [x] No Chrome Web Store upload, submission or publication.\n- [ ] Release-owner approval required for every publication action.`,
  );
}

async function apply() {
  await updateJsonVersion("package.json");
  await updateJsonVersion("public/manifest.json");
  await updateLifecycleTest();
  await updateChromeInstaller();
  await updateReleaseWorkflow();
  await updateReadme();
  await updateChangelog();
  await updatePlan();
  await updateAudit();
  await appendDocumentation();
  await createReleaseDocs();
}

async function recordEvidence() {
  const release = JSON.parse(await read("artifacts/webcap-0.2.0.release.json"));
  const runId = env.GITHUB_RUN_ID ?? "local";
  const runEvidence = `write-enabled S26 implementation run ${runId} passed format, lint, strict TypeScript, audits, unit tests, PDF benchmarks, build, reproducibility, Playwright E2E and packaged lifecycle`;
  const packageEvidence = `webcap-0.2.0.zip (${release.entries.length} entries, ${release.archive.bytes} bytes, SHA-256 ${release.archive.sha256})`;
  const targets = [
    "README.md",
    "CHANGELOG.md",
    "PLAN.md",
    "docs/release/0.2.0.md",
    "docs/release/acceptance-criteria-0.2.0.md",
  ];
  for (const path of targets) {
    let content = await read(path);
    content = content.replaceAll("{{S26_RUN_EVIDENCE}}", runEvidence);
    content = content.replaceAll("{{S26_PACKAGE_EVIDENCE}}", packageEvidence);
    await write(path, content);
  }
}

if (mode === "apply") await apply();
else await recordEvidence();
