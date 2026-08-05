import { readFile, writeFile } from "node:fs/promises";

function replaceUnique(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`S23 integration anchor is missing or not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

async function patchJobCoordinator() {
  const path = "src/background/job-coordinator.ts";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    "  get(jobId: string): Promise<CaptureJob | undefined>;\n  getActiveForTab?(tabId: number): Promise<CaptureJob | undefined>;",
    "  get(jobId: string): Promise<CaptureJob | undefined>;\n  listActive(): Promise<CaptureJob[]>;\n  getActiveForTab?(tabId: number): Promise<CaptureJob | undefined>;",
    "job coordinator port",
  );
  source = replaceUnique(
    source,
    "  async get(jobId: string): Promise<CaptureJob | undefined> {\n    await this.initialize();\n    return this.jobs.get(jobId);\n  }\n\n  async getActiveForTab(tabId: number): Promise<CaptureJob | undefined> {",
    "  async get(jobId: string): Promise<CaptureJob | undefined> {\n    await this.initialize();\n    return this.jobs.get(jobId);\n  }\n\n  async listActive(): Promise<CaptureJob[]> {\n    await this.initialize();\n    return this.jobs.listActive();\n  }\n\n  async getActiveForTab(tabId: number): Promise<CaptureJob | undefined> {",
    "job coordinator list active",
  );
  source = replaceUnique(
    source,
    "  private async recoverJob(job: CaptureJob): Promise<CaptureJob> {\n    if ([\"created\", \"ready\", \"failed\"].includes(job.state)) {\n      return job;\n    }\n\n    if (job.state === \"cancelling\") {",
    "  private async recoverJob(job: CaptureJob): Promise<CaptureJob> {\n    if ([\"created\", \"ready\", \"failed\"].includes(job.state)) {\n      return job;\n    }\n\n    const resumableAdaptiveJob =\n      job.mode === \"full-page\" &&\n      job.preferredEngine === \"scroll\" &&\n      (job.state === \"preparing\" ||\n        (job.state === \"capturing\" && job.adaptiveFrontier !== undefined));\n    if (resumableAdaptiveJob) {\n      return job;\n    }\n\n    if (job.state === \"cancelling\") {",
    "job coordinator adaptive recovery",
  );
  await writeFile(path, source, "utf8");
}

async function patchRouter() {
  const path = "src/background/persistent-job-router.ts";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    "import { createChromeDebuggerAdapter } from \"@background/chrome-debugger-adapter\";",
    "import { AdaptiveCaptureCoordinator } from \"@background/adaptive-capture-coordinator\";\nimport { createChromeDebuggerAdapter } from \"@background/chrome-debugger-adapter\";",
    "router adaptive coordinator import",
  );
  source = replaceUnique(
    source,
    "import { FullPageCaptureCoordinator } from \"@background/full-page-capture-coordinator\";",
    "import { FullPageCaptureCoordinator } from \"@background/full-page-capture-coordinator\";\nimport { ModeAwareCaptureCoordinator } from \"@background/mode-aware-capture-coordinator\";",
    "router mode coordinator import",
  );
  source = replaceUnique(
    source,
    "import { CdpCaptureEngine } from \"@capture/cdp-capture-engine\";",
    "import { AdaptiveScrollCaptureEngine } from \"@capture/adaptive-scroll-capture-engine\";\nimport { CdpCaptureEngine } from \"@capture/cdp-capture-engine\";",
    "router adaptive engine import",
  );
  source = replaceUnique(
    source,
    `  const elements = new ElementSelectionService(createChromeElementSelectionBrowserAdapter());
  const captures = new FullPageCaptureCoordinator({
    jobs,
    pages,
    tiles,
    engine: new CdpCaptureEngine(new DebuggerClient(createChromeDebuggerAdapter())),
    fallbackEngine: new ScrollCaptureEngine({ pages: scrollPages, tabs }),
    targetValidator: elements,
  });`,
    `  const elements = new ElementSelectionService(createChromeElementSelectionBrowserAdapter());
  const adaptiveCaptures = new AdaptiveCaptureCoordinator({
    jobs,
    pages,
    tiles,
    engine: new AdaptiveScrollCaptureEngine({ pages: scrollPages, tabs }),
  });
  const targetedCaptures = new FullPageCaptureCoordinator({
    jobs,
    pages,
    tiles,
    engine: new CdpCaptureEngine(new DebuggerClient(createChromeDebuggerAdapter())),
    fallbackEngine: new ScrollCaptureEngine({ pages: scrollPages, tabs }),
    targetValidator: elements,
  });
  const captures = new ModeAwareCaptureCoordinator({
    jobs,
    fullPage: adaptiveCaptures,
    targeted: targetedCaptures,
  });`,
    "router capture construction",
  );
  source = replaceUnique(
    source,
    `  const nowIso = new Date().toISOString();
  void Promise.allSettled([jobs.initialize(), dedupe.deleteExpired(nowIso)]);
  return sharedDependencies;`,
    `  const nowIso = new Date().toISOString();
  void jobs
    .initialize()
    .then(async () => {
      const activeJobs = await jobs.listActive();
      const resumable = activeJobs.filter(
        (job) =>
          job.mode === "full-page" &&
          job.preferredEngine === "scroll" &&
          (job.state === "preparing" ||
            (job.state === "capturing" && job.adaptiveFrontier !== undefined)),
      );
      await Promise.allSettled(resumable.map((job) => captures.start(job.id)));
    })
    .catch(() => undefined);
  void dedupe.deleteExpired(nowIso).catch(() => undefined);
  return sharedDependencies;`,
    "router adaptive startup resume",
  );
  await writeFile(path, source, "utf8");
}

async function patchI18n() {
  const path = "src/shared/i18n.ts";
  let source = await readFile(path, "utf8");
  source = replaceUnique(
    source,
    `  "popup.partial.max-tiles":
    "Trang vượt giới hạn số tile an toàn. WebCap đã giữ phần liên tục từ đầu trang thay vì cắt im lặng.\",
  "popup.partial.user-stop": "Bạn đã dừng sớm và giữ phần tile liên tục đã chụp được.\",`,
    `  "popup.partial.max-tiles":
    "Trang vượt giới hạn số tile an toàn. WebCap đã giữ phần liên tục từ đầu trang thay vì cắt im lặng.\",
  "popup.partial.max-estimated-bytes":
    "Dữ liệu tile đã chạm ngân sách dung lượng an toàn. WebCap giữ phần liên tục đã hoàn tất.\",
  "popup.partial.storage-quota":
    "Bộ nhớ cục bộ của Chrome đã đầy. WebCap đã bỏ hàng chưa hoàn tất và giữ phần liên tục an toàn.\",
  "popup.partial.memory-budget":
    "Lượt chụp đã chạm ngân sách bộ nhớ. Phần tile liên tục đã hoàn tất vẫn được giữ.\",
  "popup.partial.unstable-growth":
    "Trang tiếp tục tăng không ổn định. WebCap đã giữ phần liên tục đã xác nhận.\",
  "popup.partial.user-stop": "Bạn đã dừng sớm và giữ phần tile liên tục đã chụp được.\",`,
    "Vietnamese adaptive partial copy",
  );
  source = replaceUnique(
    source,
    `  "popup.partial.max-tiles":
    "The page exceeded the safe tile limit. WebCap kept a continuous prefix instead of truncating silently.\",
  "popup.partial.user-stop": "You stopped early and kept the continuous tiles captured so far.\",`,
    `  "popup.partial.max-tiles":
    "The page exceeded the safe tile limit. WebCap kept a continuous prefix instead of truncating silently.\",
  "popup.partial.max-estimated-bytes":
    "Stored tiles reached the safe byte budget. WebCap kept the completed continuous prefix.\",
  "popup.partial.storage-quota":
    "Chrome local storage became full. WebCap discarded the incomplete row and kept a safe continuous prefix.\",
  "popup.partial.memory-budget":
    "Capture reached its memory budget. The completed continuous tile prefix was retained.\",
  "popup.partial.unstable-growth":
    "The page continued growing without settling. WebCap kept the verified continuous prefix.\",
  "popup.partial.user-stop": "You stopped early and kept the continuous tiles captured so far.\",`,
    "English adaptive partial copy",
  );
  await writeFile(path, source, "utf8");
}

async function patchCoordinatorCleanup() {
  const path = "src/background/adaptive-capture-coordinator.ts";
  let source = await readFile(path, "utf8");
  source = source.replace(
    'import { contiguousStoredPrefix, rectCoveringTiles } from "@capture/partial-capture";',
    'import { rectCoveringTiles } from "@capture/partial-capture";',
  );
  source = source.replace("\nexport { contiguousStoredPrefix };\n", "\n");
  await writeFile(path, source, "utf8");
}

await patchJobCoordinator();
await patchRouter();
await patchI18n();
await patchCoordinatorCleanup();
