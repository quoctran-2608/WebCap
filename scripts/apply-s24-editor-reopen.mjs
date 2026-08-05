import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

let stateMachine = readFileSync("src/background/job-state-machine.ts", "utf8");
stateMachine = replaceOnce(
  stateMachine,
  `  completed: [],`,
  `  // Completed is quiescent by default, but a deliberate PDF-editor mutation may reopen\n  // the durable tile source so a replacement artifact can be exported without recapture.\n  completed: ["ready"],`,
  "completed editor reopen transition",
);
writeFileSync("src/background/job-state-machine.ts", stateMachine);

let editorService = readFileSync("src/background/pdf-editor-service.ts", "utf8");
editorService = replaceOnce(
  editorService,
  `import type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";`,
  `import type { ArtifactRepositoryPort } from "@storage/artifact-repository";\nimport type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";`,
  "artifact repository import",
);
editorService = replaceOnce(
  editorService,
  `  manifests: PdfEditManifestRepositoryPort;\n  now?: () => Date;`,
  `  manifests: PdfEditManifestRepositoryPort;\n  artifacts?: Pick<ArtifactRepositoryPort, "delete">;\n  now?: () => Date;`,
  "editor service artifact option",
);
editorService = replaceOnce(
  editorService,
  `  private readonly manifests: PdfEditManifestRepositoryPort;\n  private readonly now: () => Date;`,
  `  private readonly manifests: PdfEditManifestRepositoryPort;\n  private readonly artifacts: Pick<ArtifactRepositoryPort, "delete"> | undefined;\n  private readonly now: () => Date;`,
  "editor service artifact field",
);
editorService = replaceOnce(
  editorService,
  `    this.jobs = options.jobs;\n    this.manifests = options.manifests;\n    this.now = options.now ?? (() => new Date());`,
  `    this.jobs = options.jobs;\n    this.manifests = options.manifests;\n    this.artifacts = options.artifacts;\n    this.now = options.now ?? (() => new Date());`,
  "editor service artifact assignment",
);
editorService = replaceOnce(
  editorService,
  `        await this.manifests.save(next);\n        return this.snapshot(job, next);`,
  `        await this.manifests.save(next);\n        let snapshotJob = job;\n        if (job.state === "completed") {\n          try {\n            snapshotJob = await this.jobs.transition(job.id, "ready", {\n              activeOutputFormat: undefined,\n              output: undefined,\n              outputArtifactId: undefined,\n              exportProgress: undefined,\n              error: undefined,\n            });\n          } catch (error) {\n            await this.manifests.save(current).catch(() => undefined);\n            throw error;\n          }\n          if (job.outputArtifactId !== undefined) {\n            await this.artifacts?.delete(job.outputArtifactId).catch(() => false);\n          }\n        }\n        return this.snapshot(snapshotJob, next);`,
  "reopen completed editor job",
);
writeFileSync("src/background/pdf-editor-service.ts", editorService);

let editorRouter = readFileSync("src/background/pdf-editor-router.ts", "utf8");
editorRouter = replaceOnce(
  editorRouter,
  `  const offscreen = new OffscreenService();\n  sharedDependencies = {\n    editor: new PdfEditorService({ jobs: coordinator, manifests }),\n    exporter: new PdfExportService({\n      jobs: coordinator,\n      tiles: new IndexedDbTileRepository(),\n      offscreen,\n      manifests,\n    }),`,
  `  const offscreen = new OffscreenService();\n  const artifacts = new IndexedDbArtifactRepository();\n  sharedDependencies = {\n    editor: new PdfEditorService({ jobs: coordinator, manifests, artifacts }),\n    exporter: new PdfExportService({\n      jobs: coordinator,\n      tiles: new IndexedDbTileRepository(),\n      offscreen,\n      manifests,\n      artifacts,\n    }),`,
  "shared editor artifact repository",
);
editorRouter = replaceOnce(
  editorRouter,
  `  void new IndexedDbArtifactRepository()\n    .deleteExpired(new Date().toISOString())\n    .catch(() => undefined);`,
  `  void artifacts.deleteExpired(new Date().toISOString()).catch(() => undefined);`,
  "shared artifact expiry cleanup",
);
writeFileSync("src/background/pdf-editor-router.ts", editorRouter);

let editorApp = readFileSync("src/editor/App.tsx", "utf8");
editorApp = replaceOnce(
  editorApp,
  `  const canEdit = !exporting && !completed && !busy;`,
  `  const canEdit = !exporting && !busy;`,
  "completed editor controls",
);
writeFileSync("src/editor/App.tsx", editorApp);

let stateTest = readFileSync("tests/unit/job-state-machine.test.ts", "utf8");
stateTest = replaceOnce(
  stateTest,
  `  it("marks completed and cancelled as terminal", () => {\n    expect(isTerminalJobState("completed")).toBe(true);\n    expect(isTerminalJobState("cancelled")).toBe(true);\n    expect(isTerminalJobState("failed")).toBe(false);\n    expect(canTransitionJob("completed", "exporting")).toBe(false);\n  });`,
  `  it("keeps completed quiescent while allowing an explicit editor reopen", () => {\n    expect(isTerminalJobState("completed")).toBe(true);\n    expect(isTerminalJobState("cancelled")).toBe(true);\n    expect(isTerminalJobState("failed")).toBe(false);\n    expect(canTransitionJob("completed", "ready")).toBe(true);\n    expect(canTransitionJob("completed", "exporting")).toBe(false);\n  });`,
  "state-machine editor reopen test",
);
writeFileSync("tests/unit/job-state-machine.test.ts", stateTest);

let editorTest = readFileSync("tests/unit/pdf-editor-service.test.ts", "utf8");
editorTest = replaceOnce(
  editorTest,
  `  it("rejects stale revisions and page identifiers outside the current manifest", async () => {`,
  `  it("reopens a completed auto-PDF on the first edit and removes the stale artifact", async () => {\n    const base = readyJob();\n    let current: CaptureJob = {\n      ...base,\n      state: "completed",\n      stateRevision: 6,\n      activeOutputFormat: "pdf",\n      outputArtifactId: "auto-pdf",\n      output: {\n        artifactId: "auto-pdf",\n        sourceArtifactId: base.id,\n        format: "pdf",\n        mimeType: "application/pdf",\n        filename: "auto.pdf",\n        byteLength: 4_096,\n        width: 595,\n        height: 842,\n        pageCount: 3,\n        createdAt: now.toISOString(),\n        expiresAt: base.expiresAt,\n      },\n      exportProgress: { completedPages: 3, totalPages: 3 },\n    };\n    const deleted: string[] = [];\n    const jobs = {\n      get: () => Promise.resolve(structuredClone(current)),\n      transition: (\n        _jobId: string,\n        state: CaptureJob["state"],\n        patch: Partial<CaptureJob> = {},\n      ) => {\n        current = {\n          ...current,\n          ...patch,\n          state,\n          stateRevision: current.stateRevision + 1,\n          updatedAt: now.toISOString(),\n        };\n        return Promise.resolve(structuredClone(current));\n      },\n    } as unknown as PersistentJobCoordinatorPort;\n    const manifests = manifestRepository();\n    const service = new PdfEditorService({\n      jobs,\n      manifests,\n      artifacts: {\n        delete: (artifactId) => {\n          deleted.push(artifactId);\n          return Promise.resolve(true);\n        },\n      },\n      now: () => now,\n    });\n    const initial = await service.get(current.id);\n\n    const edited = await service.update(current.id, initial.manifest.revision, {\n      kind: "settings",\n      settings: { ...initial.manifest.settings, pageSize: "letter" },\n    });\n\n    expect(edited.job).toMatchObject({\n      state: "ready",\n      outputArtifactId: undefined,\n      output: undefined,\n      exportProgress: undefined,\n    });\n    expect(edited.manifest.revision).toBe(1);\n    expect(deleted).toEqual(["auto-pdf"]);\n    expect(current.tilePlan).toEqual(base.tilePlan);\n  });\n\n  it("rejects stale revisions and page identifiers outside the current manifest", async () => {`,
  "completed editor reopen service test",
);
writeFileSync("tests/unit/pdf-editor-service.test.ts", editorTest);
