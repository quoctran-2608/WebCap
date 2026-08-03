import { readFile, writeFile } from "node:fs/promises";

async function replace(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected block was not found in ${path}`);
  }
  await writeFile(path, source.replace(before, after));
}

await replace(
  "src/background/persistent-job-router.ts",
  `  const accepted =
    dependencies.pdfExports === undefined
      ? false
      : (await dependencies.pdfExports.handleProgress(message.payload)) !== undefined;
  return createOffscreenPdfExportProgressAckMessage({
    requestId: message.requestId,
    jobId: message.payload.jobId,
    accepted,
    sentAt: dependencies.now().toISOString(),
  });`,
  `  let accepted = false;
  if (dependencies.pdfExports !== undefined) {
    try {
      accepted = (await dependencies.pdfExports.handleProgress(message.payload)) !== undefined;
    } catch {
      try {
        accepted = (await dependencies.jobs.get(message.payload.jobId))?.state === "exporting";
      } catch {
        accepted = false;
      }
    }
  }
  return createOffscreenPdfExportProgressAckMessage({
    requestId: message.requestId,
    jobId: message.payload.jobId,
    accepted,
    sentAt: dependencies.now().toISOString(),
  });`,
);

await replace(
  "src/background/persistent-job-router.ts",
  `        void routePdfExportProgressMessage(message, dependencies).then((response) => {
          if (response !== undefined) {
            sendResponse(response);
          }
        });
        return true;`,
  `        void routePdfExportProgressMessage(message, dependencies)
          .then((response) => {
            if (response !== undefined) {
              sendResponse(response);
            }
          })
          .catch(() => {
            sendResponse(
              createOffscreenPdfExportProgressAckMessage({
                requestId: message.requestId,
                jobId: message.payload.jobId,
                accepted: false,
                sentAt: dependencies.now().toISOString(),
              }),
            );
          });
        return true;`,
);

await replace(
  "src/editor/thumbnail-service.ts",
  `export interface PdfThumbnailOptions {`,
  `export interface PdfThumbnailResult {
  metadata: ArtifactMetadata;
  blob: Blob;
}

export interface PdfThumbnailOptions {`,
);

await replace(
  "src/editor/thumbnail-service.ts",
  `async function renderPdfPageThumbnail(options: PdfThumbnailOptions): Promise<ArtifactMetadata> {`,
  `async function renderPdfPageThumbnail(options: PdfThumbnailOptions): Promise<PdfThumbnailResult> {`,
);

await replace(
  "src/editor/thumbnail-service.ts",
  `    return metadata(cached);`,
  `    return { metadata: metadata(cached), blob: cached.blob };`,
);

await replace(
  "src/editor/thumbnail-service.ts",
  `    await artifacts.put(record);
    return metadata(record);`,
  `    await artifacts.put(record);
    return { metadata: metadata(record), blob };`,
);

await replace(
  "src/editor/thumbnail-service.ts",
  `export function createPdfPageThumbnail(options: PdfThumbnailOptions): Promise<ArtifactMetadata> {`,
  `export function createPdfPageThumbnail(options: PdfThumbnailOptions): Promise<PdfThumbnailResult> {`,
);

await replace(
  "src/editor/App.tsx",
  `import { IndexedDbArtifactRepository } from "@storage/artifact-repository";

`,
  ``,
);

await replace(
  "src/editor/App.tsx",
  `const artifacts = new IndexedDbArtifactRepository();

`,
  ``,
);

await replace(
  "src/editor/App.tsx",
  `        const metadata = await createPdfPageThumbnail({
          jobId: snapshot.job.id,
          manifestRevision: snapshot.manifest.revision,
          page,
          tiles: snapshot.job.tilePlan,
          expiresAt: snapshot.job.expiresAt,
        });
        const record = await artifacts.get(metadata.artifactId);
        if (!active || record?.blob === undefined) return;
        objectUrl = URL.createObjectURL(record.blob);`,
  `        const thumbnail = await createPdfPageThumbnail({
          jobId: snapshot.job.id,
          manifestRevision: snapshot.manifest.revision,
          page,
          tiles: snapshot.job.tilePlan,
          expiresAt: snapshot.job.expiresAt,
        });
        if (!active) return;
        objectUrl = URL.createObjectURL(thumbnail.blob);`,
);

await replace(
  "tests/unit/pdf-thumbnail-service.test.ts",
  `    expect(first).toEqual(second);
    expect(first).toMatchObject({
      format: "jpeg",
      mimeType: "image/jpeg",
      width: 213,
      height: 320,
    });
    expect(Math.max(first.width, first.height)).toBeLessThanOrEqual(320);`,
  `    expect(first).toEqual(second);
    expect(first.metadata).toMatchObject({
      format: "jpeg",
      mimeType: "image/jpeg",
      width: 213,
      height: 320,
    });
    expect(first.blob.type).toBe("image/jpeg");
    expect(Math.max(first.metadata.width, first.metadata.height)).toBeLessThanOrEqual(320);`,
);

await replace(
  "tests/unit/persistent-job-router.test.ts",
  `  routePersistentJobMessage,
  type PersistentJobRouterDependencies,`,
  `  routePdfExportProgressMessage,
  routePersistentJobMessage,
  type PersistentJobRouterDependencies,`,
);

await replace(
  "tests/unit/persistent-job-router.test.ts",
  `import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";`,
  `import { createOffscreenPdfExportProgressMessage } from "@shared/contracts/offscreen";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";`,
);

await replace(
  "tests/unit/persistent-job-router.test.ts",
  `  it("ignores unrelated runtime messages", async () => {`,
  `  it("acknowledges progress while an exporting job remains active even if persistence fails", async () => {
    const jobs = new FakeCoordinator();
    jobs.current = {
      ...job(),
      state: "exporting",
      stateRevision: 4,
      exportProgress: { completedPages: 0, totalPages: 3 },
    };
    const dedupe = new MemoryDedupe();
    const message = createOffscreenPdfExportProgressMessage({
      requestId: "progress-1",
      sentAt: now.toISOString(),
      jobId: jobs.current.id,
      completedPages: 1,
      totalPages: 3,
    });
    const response = await routePdfExportProgressMessage(message, {
      ...dependencies(jobs, dedupe),
      pdfExports: {
        start: () => Promise.resolve(jobs.current as CaptureJob),
        handleProgress: () => Promise.reject(new Error("progress persistence failed")),
      },
    });

    expect(response).toMatchObject({
      type: "OFFSCREEN_PDF_EXPORT_PROGRESS_ACK",
      payload: { jobId: jobs.current.id, accepted: true },
    });
  });

  it("ignores unrelated runtime messages", async () => {`,
);
