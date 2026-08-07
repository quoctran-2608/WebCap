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

await edit("src/background/pdf-editor-service.ts", (text) => {
  text = replaceOnce(
    text,
    `import { planPdfDocument } from "@offscreen/pdf-layout";`,
    `import { planPdfDocument, planPdfDocumentPages } from "@offscreen/pdf-layout";`,
    "editor logical page planner import",
  );
  text = replaceOnce(
    text,
    `    !["full-page", "region", "element"].includes(job.mode) ||`,
    `    !["full-page", "region", "element", "scroll-area"].includes(job.mode) ||`,
    "scroll-area editor mode",
  );
  return replaceOnce(
    text,
    `function createPages(job: CaptureJob, settings: CaptureJob["settings"]["pdf"]): PdfEditorPage[] {
  const targetRect = job.targetRect;
  if (targetRect === undefined) {
    throw editorError(
      "The PDF editor target rectangle is unavailable.",
      "PdfEditorTargetMissing",
      job.id,
    );
  }
  return planPdfDocument(targetRect, settings).pages.map((page) => ({
    id: \`page-\${page.index + 1}\`,
    originalIndex: page.index,
    sourceRectCss: page.sourceRectCss,
    pageWidthPt: page.pageWidthPt,
    pageHeightPt: page.pageHeightPt,
    imageRectPt: page.imageRectPt,
  }));
}`,
    `function createPages(job: CaptureJob, settings: CaptureJob["settings"]["pdf"]): PdfEditorPage[] {
  const targetRect = job.targetRect;
  if (targetRect === undefined) {
    throw editorError(
      "The PDF editor target rectangle is unavailable.",
      "PdfEditorTargetMissing",
      job.id,
    );
  }
  const pageMap = job.documentPageMap;
  if (pageMap !== undefined) {
    const right = targetRect.x + targetRect.width;
    const bottom = targetRect.y + targetRect.height;
    const sourcePages = pageMap.pages.filter((page) => {
      const rect = page.sourceRectCss;
      return (
        rect.x >= targetRect.x - 0.01 &&
        rect.y >= targetRect.y - 0.01 &&
        rect.x + rect.width <= right + 0.01 &&
        rect.y + rect.height <= bottom + 0.01
      );
    });
    if (sourcePages.length === 0) {
      throw editorError(
        "The detected document does not contain a fully captured page.",
        "PdfEditorDocumentPagesUnavailable",
        job.id,
        true,
      );
    }
    return planPdfDocumentPages(
      {
        ...pageMap,
        complete: sourcePages.length === pageMap.sourcePageCount,
        sourcePageCount: sourcePages.length,
        pages: sourcePages.map((page, index) => ({ ...page, index })),
      },
      settings,
    ).map((page) => ({
      id: \`document-page-\${page.index + 1}\`,
      originalIndex: page.index,
      sourceRectCss: page.sourceRectCss,
      pageWidthPt: page.pageWidthPt,
      pageHeightPt: page.pageHeightPt,
      imageRectPt: page.imageRectPt,
    }));
  }
  return planPdfDocument(targetRect, settings).pages.map((page) => ({
    id: \`page-\${page.index + 1}\`,
    originalIndex: page.index,
    sourceRectCss: page.sourceRectCss,
    pageWidthPt: page.pageWidthPt,
    pageHeightPt: page.pageHeightPt,
    imageRectPt: page.imageRectPt,
  }));
}`,
    "editor logical page creation",
  );
});

await edit("src/offscreen/pdf-exporter.ts", (text) =>
  replaceOnce(
    text,
    `      widthCss: Math.max(...pages.map((page) => page.sourceRectCss.width)),
      heightCss: payload.targetRect.height,`,
    `      widthCss: Math.max(...pages.map((page) => page.sourceRectCss.width)),
      heightCss: Math.max(...pages.map((page) => page.sourceRectCss.height)),`,
    "page-at-a-time memory dimensions",
  ),
);

await edit("src/shared/contracts/job.ts", (text) =>
  replaceOnce(
    text,
    `export function summarizeJob(job: CaptureJob): JobSummary {
  const storedBottom = Math.max(
    0,
    ...job.tilePlan
      .filter((tile) => tile.status === "stored")
      .map((tile) => {
        const rect = tile.outputRectCss ?? tile.sourceRectCss;
        return rect.y + rect.height;
      }),
  );
  const completedDocumentPages = job.documentPageMap?.pages.filter(
    (page) => page.sourceRectCss.y + page.sourceRectCss.height <= storedBottom + 0.01,
  ).length;`,
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
  }).length;`,
    "two-dimensional document progress",
  ),
);

await edit("src/content/entry.ts", (text) =>
  replaceOnce(
    text,
    `function documentPageIndex(element: Element): number | undefined {
  const directIndex = positiveIntegerAttribute(element, ["data-page-index", "page-index"]);
  if (directIndex !== undefined) return directIndex;
  const pageNumber = positiveIntegerAttribute(element, ["data-page-number", "page-number"]);
  if (pageNumber !== undefined) return pageNumber - 1;
  const label = element.getAttribute("aria-label") ?? "";
  const match = /(?:page|trang)\\s*(\\d+)/iu.exec(label)?.[1];
  if (match === undefined) return undefined;
  const parsed = Number.parseInt(match, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : undefined;
}`,
    `function documentPageIndex(element: Element): number | undefined {
  const directRaw = element.getAttribute("data-page-index") ?? element.getAttribute("page-index");
  if (directRaw !== null) {
    const directIndex = Number.parseInt(directRaw, 10);
    if (Number.isInteger(directIndex) && directIndex >= 0) return directIndex;
  }
  const pageNumber = positiveIntegerAttribute(element, ["data-page-number", "page-number"]);
  if (pageNumber !== undefined) return pageNumber - 1;
  const label = element.getAttribute("aria-label") ?? "";
  const match = /(?:page|trang)\\s*(\\d+)/iu.exec(label)?.[1];
  if (match === undefined) return undefined;
  const parsed = Number.parseInt(match, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : undefined;
}`,
    "zero-based document page index",
  ),
);

await edit("tests/unit/pdf-editor-service.test.ts", (text) => {
  const test = `
  it("keeps detected scroll-area PDF pages intact in the editor and after settings changes", async () => {
    const base = readyJob();
    const job: CaptureJob = {
      ...base,
      mode: "scroll-area",
      preferredEngine: "scroll",
      activeEngine: "scroll",
      targetRect: { x: 0, y: 0, width: 900, height: 2_400 },
      documentPageMap: {
        schemaVersion: 1,
        strategy: "dom",
        confidence: 1,
        complete: true,
        sourcePageCount: 2,
        pages: [
          { index: 0, sourceRectCss: { x: 100, y: 20, width: 700, height: 1_000 } },
          { index: 1, sourceRectCss: { x: 100, y: 1_220, width: 700, height: 1_000 } },
        ],
      },
    };
    const manifests = manifestRepository();
    const service = new PdfEditorService({ jobs: jobReader(job), manifests, now: () => now });

    const initial = await service.get(job.id);
    const updated = await service.update(job.id, initial.manifest.revision, {
      kind: "settings",
      settings: { ...initial.manifest.settings, pageSize: "letter" },
    });

    expect(initial.manifest.pages.map((page) => page.id)).toEqual([
      "document-page-1",
      "document-page-2",
    ]);
    expect(initial.manifest.pages.map((page) => page.sourceRectCss)).toEqual(
      job.documentPageMap?.pages.map((page) => page.sourceRectCss),
    );
    expect(updated.manifest.pages).toHaveLength(2);
    expect(updated.manifest.pages.map((page) => page.sourceRectCss)).toEqual(
      initial.manifest.pages.map((page) => page.sourceRectCss),
    );
  });

`;
  return replaceOnce(
    text,
    `  it("recomputes pages for settings and persists non-destructive remove/reorder edits", async () => {`,
    `${test}  it("recomputes pages for settings and persists non-destructive remove/reorder edits", async () => {`,
    "page-aware editor regression",
  );
});

await edit("tests/unit/pdf-exporter.test.ts", (text) => {
  const test = `
  it("uses the largest logical page rather than total document height for the memory guard", async () => {
    const source = storedTile();
    const repository = repositories([source.record]);
    const exporter = new PdfExporter({
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment: pageEnvironment(),
    });

    const result = await exporter.export({
      jobId: "job-1",
      outputArtifactId: "pdf-streamed-pages",
      targetRect: { x: 0, y: 0, width: 100, height: 20_000_000 },
      tiles: [source.tile],
      pages: [
        {
          id: "document-page-1",
          originalIndex: 0,
          sourceRectCss: { x: 0, y: 0, width: 100, height: 150 },
          pageWidthPt: 100,
          pageHeightPt: 150,
          imageRectPt: { x: 0, y: 0, width: 100, height: 150 },
        },
        {
          id: "document-page-2",
          originalIndex: 1,
          sourceRectCss: { x: 0, y: 150, width: 100, height: 150 },
          pageWidthPt: 100,
          pageHeightPt: 150,
          imageRectPt: { x: 0, y: 0, width: 100, height: 150 },
        },
      ],
      settings: DEFAULT_CAPTURE_SETTINGS.pdf,
      filename: "streamed-pages.pdf",
      createdAt: "2026-08-03T11:01:00.000Z",
      expiresAt: "2026-08-03T11:31:00.000Z",
    });

    expect(result.diagnostics.pageCount).toBe(2);
    expect(result.diagnostics.memoryEstimate.shouldBlock).toBe(false);
    expect(result.diagnostics.memoryEstimate.totalPixels).toBe(15_000);
    expect(repository.stored()?.pageCount).toBe(2);
  });

`;
  return replaceOnce(
    text,
    `  it("fails before allocating a page when a stored source tile is missing", async () => {`,
    `${test}  it("fails before allocating a page when a stored source tile is missing", async () => {`,
    "streamed logical page memory regression",
  );
});

await writeFile(
  "tests/unit/job-summary-document-progress.test.ts",
  `import { describe, expect, it } from "vitest";

import { summarizeJob } from "@shared/contracts/job";
import type { CaptureJob, CaptureTile } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const now = "2026-08-07T05:30:00.000Z";

function tile(index: number, x: number, status: CaptureTile["status"]): CaptureTile {
  return {
    id: \`job-progress:\${index}\`,
    jobId: "job-progress",
    index,
    row: 0,
    column: index,
    sourceRectCss: { x, y: 0, width: 100, height: 100 },
    outputRectCss: { x, y: 0, width: 100, height: 100 },
    expectedPixelWidth: 100,
    expectedPixelHeight: 100,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    overlapRightCss: 0,
    overlapBottomCss: 0,
    status,
    attempts: status === "stored" ? 1 : 0,
    ...(status === "stored" ? { byteLength: 100, mimeType: "image/png" as const } : {}),
  };
}

function job(rightStored: boolean): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-progress",
    tabId: 7,
    windowId: 3,
    source: { createdAt: now },
    mode: "scroll-area",
    preferredEngine: "scroll",
    activeEngine: "scroll",
    state: "capturing",
    stateRevision: 2,
    targetRect: { x: 0, y: 0, width: 200, height: 100 },
    documentPageMap: {
      schemaVersion: 1,
      strategy: "dom",
      confidence: 1,
      complete: true,
      sourcePageCount: 1,
      pages: [{ index: 0, sourceRectCss: { x: 0, y: 0, width: 200, height: 100 } }],
    },
    tilePlan: [tile(0, 0, "stored"), tile(1, 100, rightStored ? "stored" : "planned")],
    completedTiles: rightStored ? 2 : 1,
    totalTiles: 2,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt: now,
    updatedAt: now,
    expiresAt: "2026-08-07T06:30:00.000Z",
  };
}

describe("document page progress summary", () => {
  it("does not report a page complete when only its vertical extent is covered", () => {
    expect(summarizeJob(job(false))).toMatchObject({
      completedTiles: 1,
      totalTiles: 2,
      completedDocumentPages: 0,
      totalDocumentPages: 1,
    });
  });

  it("reports the page complete after all four corners are covered", () => {
    expect(summarizeJob(job(true))).toMatchObject({
      completedTiles: 2,
      totalTiles: 2,
      completedDocumentPages: 1,
      totalDocumentPages: 1,
    });
  });
});
`,
);
