import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function replaceCount(source, needle, replacement, expected, label) {
  const parts = source.split(needle);
  if (parts.length - 1 !== expected) {
    throw new Error(`${label}: expected ${expected} matches, found ${parts.length - 1}`);
  }
  return parts.join(replacement);
}

function patchFile(path, patch) {
  const source = readFileSync(path, "utf8");
  writeFileSync(path, patch(source));
}

patchFile("src/background/job-coordinator.ts", (source) => {
  source = replaceOnce(
    source,
    'import type { CaptureOwnedDataCleanupPort } from "./capture-data-cleanup-service";\n',
    'import type { CaptureOwnedDataCleanupPort } from "./capture-data-cleanup-service";\nimport { createCaptureCompletionPolicy } from "./capture-completion-policy";\n',
    "job coordinator completion-policy import",
  );
  return replaceOnce(
    source,
    "      settings: options.settings,\n      cleanup: { attempted: false, completed: false },",
    "      settings: options.settings,\n      completionPolicy: createCaptureCompletionPolicy(options.mode, options.settings),\n      cleanup: { attempted: false, completed: false },",
    "job coordinator persisted completion policy",
  );
});

patchFile("src/background/persistent-job-router.ts", (source) => {
  source = replaceOnce(
    source,
    'import { AdaptiveCaptureCoordinator } from "@background/adaptive-capture-coordinator";\n',
    'import { AdaptiveCaptureCoordinator } from "@background/adaptive-capture-coordinator";\nimport { CaptureCompletionService } from "@background/capture-completion-service";\n',
    "router completion service import",
  );
  source = replaceOnce(
    source,
    'import { ScrollCaptureEngine } from "@capture/scroll-capture-engine";\n',
    'import { ScrollCaptureEngine } from "@capture/scroll-capture-engine";\nimport { TiledImageExportService } from "@background/tiled-image-export-service";\n',
    "router tiled image service import",
  );
  source = replaceOnce(
    source,
    "export interface PersistentJobRouterDependencies {\n",
    "export interface CaptureCompletionPort {\n  startAuto(jobId: string): Promise<CaptureJob>;\n  recoverAll(): Promise<CaptureJob[]>;\n  cancel(jobId: string): Promise<CaptureJob>;\n  waitForIdle(jobId: string): Promise<void>;\n}\n\nexport interface PersistentJobRouterDependencies {\n",
    "router completion port",
  );
  source = replaceOnce(
    source,
    "  pdfExports?: PdfExportPort;\n  reset?: Pick<CaptureResetService, \"reset\">;",
    "  pdfExports?: PdfExportPort;\n  completion?: CaptureCompletionPort;\n  reset?: Pick<CaptureResetService, \"reset\">;",
    "router completion dependency",
  );
  source = replaceOnce(
    source,
    "function addMilliseconds(date: Date, milliseconds: number): string {\n  return new Date(date.getTime() + milliseconds).toISOString();\n}\n",
    "function addMilliseconds(date: Date, milliseconds: number): string {\n  return new Date(date.getTime() + milliseconds).toISOString();\n}\n\nasync function runCaptureAndCompletion(\n  jobId: string,\n  captures: FullPageCapturePort,\n  completion?: CaptureCompletionPort,\n): Promise<void> {\n  await captures.start(jobId);\n  await completion?.startAuto(jobId);\n}\n\nfunction startCaptureAndCompletion(\n  jobId: string,\n  captures: FullPageCapturePort,\n  completion?: CaptureCompletionPort,\n): void {\n  void runCaptureAndCompletion(jobId, captures, completion).catch(() => undefined);\n}\n",
    "router capture-completion helpers",
  );
  source = replaceOnce(
    source,
    "  const artifacts = new IndexedDbArtifactRepository();\n  const pdfExports = new PdfExportService({\n    jobs,\n    tiles,\n    offscreen: new OffscreenService(),\n    manifests,\n    artifacts,\n  });",
    "  const artifacts = new IndexedDbArtifactRepository();\n  const offscreen = new OffscreenService();\n  const pdfExports = new PdfExportService({\n    jobs,\n    tiles,\n    offscreen,\n    manifests,\n    artifacts,\n  });\n  const imageExports = new TiledImageExportService({\n    jobs,\n    offscreen,\n    artifacts,\n  });\n  const completion = new CaptureCompletionService({\n    jobs,\n    pdf: pdfExports,\n    images: imageExports,\n    artifacts,\n  });",
    "router output service construction",
  );
  source = replaceOnce(
    source,
    "    scrollAreaCaptures,\n    pdfExports,\n    regionSelections: regions,",
    "    scrollAreaCaptures,\n    pdfExports: completion,\n    regionSelections: regions,",
    "router reset completion ownership",
  );
  source = replaceOnce(
    source,
    "    elements,\n    pdfExports,\n    reset,",
    "    elements,\n    pdfExports,\n    completion,\n    reset,",
    "router shared completion dependency",
  );
  source = replaceOnce(
    source,
    "      await Promise.allSettled(resumable.map((job) => captures.start(job.id)));\n    })",
    "      await Promise.allSettled(\n        resumable.map((job) => runCaptureAndCompletion(job.id, captures, completion)),\n      );\n      await completion.recoverAll();\n    })",
    "router startup capture and output recovery",
  );
  source = replaceCount(
    source,
    "        void dependencies.captures.start(job.id).catch(() => undefined);",
    "        startCaptureAndCompletion(job.id, dependencies.captures, dependencies.completion);",
    2,
    "router full-page and region auto completion",
  );
  return replaceOnce(
    source,
    "      void coordinator.start(job.id).catch(() => undefined);",
    "      startCaptureAndCompletion(job.id, coordinator, dependencies.completion);",
    "router selected-target auto completion",
  );
});

patchFile("tests/unit/job-coordinator.test.ts", (source) =>
  replaceOnce(
    source,
    '    expect(created).toMatchObject({ id: "job-created", state: "created", stateRevision: 0 });',
    '    expect(created).toMatchObject({\n      id: "job-created",\n      state: "created",\n      stateRevision: 0,\n      completionPolicy: {\n        primaryOutput: "pdf",\n        autoExport: true,\n        openEditorAfterCapture: false,\n        allowGuardedImageFallback: false,\n      },\n    });',
    "job coordinator durable policy assertion",
  ),
);

patchFile("tests/unit/persistent-job-router.test.ts", (source) => {
  source = replaceOnce(
    source,
    '  captures?: PersistentJobRouterDependencies["captures"],\n): PersistentJobRouterDependencies {\n  return { jobs, dedupe, now: () => now, ...(captures === undefined ? {} : { captures }) };\n}',
    '  captures?: PersistentJobRouterDependencies["captures"],\n  completion?: PersistentJobRouterDependencies["completion"],\n): PersistentJobRouterDependencies {\n  return {\n    jobs,\n    dedupe,\n    now: () => now,\n    ...(captures === undefined ? {} : { captures }),\n    ...(completion === undefined ? {} : { completion }),\n  };\n}',
    "router test dependency helper",
  );
  return replaceOnce(
    source,
    '  it("uses capture reset when a region selector does not become ready", async () => {',
    '  it("starts automatic output only after full-page capture finishes", async () => {\n    const jobs = new FakeCoordinator();\n    const dedupe = new MemoryDedupe();\n    const order: string[] = [];\n    const start = vi.fn(async () => {\n      order.push("capture");\n    });\n    const cancel = vi.fn(() => Promise.resolve(job()));\n    const startAuto = vi.fn(async () => {\n      order.push("output");\n      return { ...job(), state: "exporting" as const, stateRevision: 5 };\n    });\n    const completion = {\n      startAuto,\n      recoverAll: vi.fn(() => Promise.resolve([])),\n      cancel: vi.fn(() => Promise.resolve(job())),\n      waitForIdle: vi.fn(() => Promise.resolve()),\n    };\n    const message = createJobCreateMessage({\n      requestId: "request-auto-output",\n      sentAt: now.toISOString(),\n      tabId: 7,\n      windowId: 2,\n      mode: "full-page",\n      settings: DEFAULT_CAPTURE_SETTINGS,\n    });\n\n    await routePersistentJobMessage(\n      message,\n      dependencies(jobs, dedupe, { start, cancel }, completion),\n    );\n    await vi.waitFor(() => expect(startAuto).toHaveBeenCalledWith("job-1"));\n\n    expect(order).toEqual(["capture", "output"]);\n  });\n\n  it("uses capture reset when a region selector does not become ready", async () => {',
    "router automatic completion test",
  );
});

const files = [
  "src/background/job-coordinator.ts",
  "src/background/persistent-job-router.ts",
  "tests/unit/job-coordinator.test.ts",
  "tests/unit/persistent-job-router.test.ts",
];
const prettier = spawnSync("pnpm", ["exec", "prettier", "--write", ...files], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
process.stdout.write(prettier.stdout ?? "");
process.stderr.write(prettier.stderr ?? "");
if (prettier.status !== 0) process.exit(prettier.status ?? 1);

for (const file of files) {
  const destination = `artifacts/s24-router/${file}`;
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(file, destination);
}
writeFileSync(
  "artifacts/s24-router/manifest.json",
  `${JSON.stringify({ files }, null, 2)}\n`,
);
process.exit(1);
