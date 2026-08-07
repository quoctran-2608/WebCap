import { readFile, writeFile } from "node:fs/promises";

async function edit(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after);
}

function replaceOnce(text, before, after, label) {
  const index = text.indexOf(before);
  if (index < 0) throw new Error(`Anchor not found: ${label}`);
  if (text.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Anchor is not unique: ${label}`);
  }
  return text.slice(0, index) + after + text.slice(index + before.length);
}

await edit("src/shared/contracts/job.ts", (text) =>
  replaceOnce(
    text,
    `export function summarizeJob(job: CaptureJob): JobSummary {
  const storedRects = job.tilePlan
    .filter((tile) => tile.status === "stored")
    .map((tile) => tile.outputRectCss ?? tile.sourceRectCss);
  const completedDocumentPages = job.documentPageMap?.pages.filter((page) => {
    const rect = page.sourceRectCss;
    const epsilon = 0.01;
    const points = [
      { x: rect.x + epsilon, y: rect.y + epsilon },
      { x: rect.x + rect.width - epsilon, y: rect.y + epsilon },
      { x: rect.x + epsilon, y: rect.y + rect.height - epsilon },
      { x: rect.x + rect.width - epsilon, y: rect.y + rect.height - epsilon },
    ];
    return points.every((point) =>
      storedRects.some(
        (stored) =>
          point.x >= stored.x - epsilon &&
          point.y >= stored.y - epsilon &&
          point.x <= stored.x + stored.width + epsilon &&
          point.y <= stored.y + stored.height + epsilon,
      ),
    );
  }).length;
  return JobSummarySchema.parse({`,
    `export interface DocumentPageProgress {
  completed: number;
  total: number;
}

export function documentPageProgress(job: CaptureJob): DocumentPageProgress | undefined {
  const pageMap = job.documentPageMap;
  if (pageMap === undefined) return undefined;
  const storedRects = job.tilePlan
    .filter((tile) => tile.status === "stored")
    .map((tile) => tile.outputRectCss ?? tile.sourceRectCss);
  const completed = pageMap.pages.filter((page) => {
    const rect = page.sourceRectCss;
    const epsilon = 0.01;
    const points = [
      { x: rect.x + epsilon, y: rect.y + epsilon },
      { x: rect.x + rect.width - epsilon, y: rect.y + epsilon },
      { x: rect.x + epsilon, y: rect.y + rect.height - epsilon },
      { x: rect.x + rect.width - epsilon, y: rect.y + rect.height - epsilon },
    ];
    return points.every((point) =>
      storedRects.some(
        (stored) =>
          point.x >= stored.x - epsilon &&
          point.y >= stored.y - epsilon &&
          point.x <= stored.x + stored.width + epsilon &&
          point.y <= stored.y + stored.height + epsilon,
      ),
    );
  }).length;
  return { completed, total: pageMap.sourcePageCount };
}

export function summarizeJob(job: CaptureJob): JobSummary {
  const pageProgress = documentPageProgress(job);
  return JobSummarySchema.parse({`,
    "shared document page progress helper",
  ).replace(
    `    ...(completedDocumentPages === undefined ? {} : { completedDocumentPages }),
    ...(job.documentPageMap === undefined
      ? {}
      : { totalDocumentPages: job.documentPageMap.sourcePageCount }),`,
    `    ...(pageProgress === undefined
      ? {}
      : {
          completedDocumentPages: pageProgress.completed,
          totalDocumentPages: pageProgress.total,
        }),`,
  ),
);

await edit("src/shared/diagnostics.ts", (text) => {
  text = replaceOnce(
    text,
    `import type { CaptureEngineKind, CaptureMode, JobState } from "@shared/contracts/domain";`,
    `import type {
  CaptureEngineKind,
  CaptureMode,
  JobState,
  PartialCaptureReason,
} from "@shared/contracts/domain";`,
    "diagnostics partial reason import",
  );
  text = text.replace(
    `    completedTiles?: number;
    totalTiles?: number;
    errorCode?: WebCapErrorCode;`,
    `    completedTiles?: number;
    totalTiles?: number;
    completedDocumentPages?: number;
    totalDocumentPages?: number;
    partialCaptureReason?: PartialCaptureReason;
    errorCode?: WebCapErrorCode;`,
  );
  text = text.replace(
    `    completedTiles?: number;
    totalTiles?: number;
    errorCode?: WebCapErrorCode;`,
    `    completedTiles?: number;
    totalTiles?: number;
    completedDocumentPages?: number;
    totalDocumentPages?: number;
    partialCaptureReason?: PartialCaptureReason;
    errorCode?: WebCapErrorCode;`,
  );
  text = replaceOnce(
    text,
    `  const completedTiles = finiteCount(input.job?.completedTiles);
  const totalTiles = finiteCount(input.job?.totalTiles);`,
    `  const completedTiles = finiteCount(input.job?.completedTiles);
  const totalTiles = finiteCount(input.job?.totalTiles);
  const completedDocumentPages = finiteCount(input.job?.completedDocumentPages);
  const totalDocumentPages = finiteCount(input.job?.totalDocumentPages);`,
    "diagnostics page counts",
  );
  return replaceOnce(
    text,
    `            ...(completedTiles === undefined ? {} : { completedTiles }),
            ...(totalTiles === undefined ? {} : { totalTiles }),
            ...(input.job.errorCode === undefined ? {} : { errorCode: input.job.errorCode }),`,
    `            ...(completedTiles === undefined ? {} : { completedTiles }),
            ...(totalTiles === undefined ? {} : { totalTiles }),
            ...(completedDocumentPages === undefined
              ? {}
              : { completedDocumentPages }),
            ...(totalDocumentPages === undefined ? {} : { totalDocumentPages }),
            ...(input.job.partialCaptureReason === undefined
              ? {}
              : { partialCaptureReason: input.job.partialCaptureReason }),
            ...(input.job.errorCode === undefined ? {} : { errorCode: input.job.errorCode }),`,
    "diagnostics page progress payload",
  );
});

await edit("src/popup/App.tsx", (text) => {
  text = replaceOnce(
    text,
    `import { serializeSafeDiagnostics } from "@shared/diagnostics";`,
    `import { serializeSafeDiagnostics } from "@shared/diagnostics";
import { documentPageProgress } from "@shared/contracts/job";`,
    "popup document progress import",
  );
  text = replaceOnce(
    text,
    `  const fullPageProgress =
    fullPageJob === undefined || fullPageJob.totalTiles === 0
      ? 0
      : Math.round((fullPageJob.completedTiles / fullPageJob.totalTiles) * 100);`,
    `  const documentProgress =
    fullPageJob === undefined ? undefined : documentPageProgress(fullPageJob);
  const progressCompleted = documentProgress?.completed ?? fullPageJob?.completedTiles ?? 0;
  const progressTotal = documentProgress?.total ?? fullPageJob?.totalTiles ?? 0;
  const fullPageProgress =
    progressTotal === 0 ? 0 : Math.round((progressCompleted / progressTotal) * 100);`,
    "popup page-aware percentage",
  );
  text = replaceOnce(
    text,
    `                completedTiles: fullPageJob.completedTiles,
                totalTiles: fullPageJob.totalTiles,
                ...(fullPageJob.error === undefined ? {} : { errorCode: fullPageJob.error.code }),`,
    `                completedTiles: fullPageJob.completedTiles,
                totalTiles: fullPageJob.totalTiles,
                ...(documentProgress === undefined
                  ? {}
                  : {
                      completedDocumentPages: documentProgress.completed,
                      totalDocumentPages: documentProgress.total,
                    }),
                ...(fullPageJob.partialCapture === undefined
                  ? {}
                  : { partialCaptureReason: fullPageJob.partialCapture.reason }),
                ...(fullPageJob.error === undefined ? {} : { errorCode: fullPageJob.error.code }),`,
    "popup diagnostics document progress",
  );
  return replaceOnce(
    text,
    `              <progress
                value={fullPageJob.completedTiles}
                max={Math.max(1, fullPageJob.totalTiles)}`, 
    `              <progress
                value={progressCompleted}
                max={Math.max(1, progressTotal)}`,
    "popup progress element",
  );
});

await edit("tests/unit/diagnostics.test.ts", (text) => {
  text = replaceOnce(
    text,
    `        completedTiles: 4.9,
        totalTiles: Number.POSITIVE_INFINITY,
        errorCode: "E_LAYOUT_UNSTABLE",`,
    `        completedTiles: 4.9,
        totalTiles: Number.POSITIVE_INFINITY,
        completedDocumentPages: 63.8,
        totalDocumentPages: 126,
        partialCaptureReason: "max-tiles",
        errorCode: "E_LAYOUT_UNSTABLE",`,
    "diagnostics document progress input",
  );
  return replaceOnce(
    text,
    `        completedTiles: 4,
        errorCode: "E_LAYOUT_UNSTABLE",`,
    `        completedTiles: 4,
        completedDocumentPages: 63,
        totalDocumentPages: 126,
        partialCaptureReason: "max-tiles",
        errorCode: "E_LAYOUT_UNSTABLE",`,
    "diagnostics document progress expectation",
  );
});
