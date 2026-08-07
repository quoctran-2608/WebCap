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

await edit("src/shared/constants.ts", (text) =>
  replaceOnce(
    text,
    "export const DEFAULT_MAX_TILES = 256;\n",
    "export const DEFAULT_MAX_TILES = 256;\nexport const PDF_VIEWER_MAX_DOCUMENT_TILES = 4_096;\n",
    "PDF document tile cap",
  ),
);

await edit("src/shared/contracts/domain.ts", (text) => {
  text = replaceOnce(
    text,
    `export const RectSchema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    width: NonNegativeFiniteNumberSchema,
    height: NonNegativeFiniteNumberSchema,
  })
  .strict();

export const ElementTargetDescriptorSchema`,
    `export const RectSchema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    width: NonNegativeFiniteNumberSchema,
    height: NonNegativeFiniteNumberSchema,
  })
  .strict();

export const DocumentPageSchema = z
  .object({
    index: NonNegativeIntegerSchema,
    sourceRectCss: RectSchema.refine((rect) => rect.width > 0 && rect.height > 0),
  })
  .strict();

export const DocumentPageMapSchema = z
  .object({
    schemaVersion: z.literal(1),
    strategy: z.enum(["dom", "projected"]),
    confidence: z.number().finite().min(0).max(1),
    complete: z.boolean(),
    sourcePageCount: PositiveIntegerSchema,
    pages: z.array(DocumentPageSchema).min(1).max(10_000),
  })
  .strict();

export const ElementTargetDescriptorSchema`,
    "document page schemas",
  );
  text = replaceOnce(
    text,
    `    targetDescriptor: ElementTargetDescriptorSchema.optional(),
    tilePlan: z.array(CaptureTileSchema),`,
    `    targetDescriptor: ElementTargetDescriptorSchema.optional(),
    documentPageMap: DocumentPageMapSchema.optional(),
    tilePlan: z.array(CaptureTileSchema),`,
    "capture job page map",
  );
  return replaceOnce(
    text,
    `export type Rect = z.infer<typeof RectSchema>;
export type ElementTargetDescriptor = z.infer<typeof ElementTargetDescriptorSchema>;`,
    `export type Rect = z.infer<typeof RectSchema>;
export type DocumentPage = z.infer<typeof DocumentPageSchema>;
export type DocumentPageMap = z.infer<typeof DocumentPageMapSchema>;
export type ElementTargetDescriptor = z.infer<typeof ElementTargetDescriptorSchema>;`,
    "document page types",
  );
});

await edit("src/capture/document-page-map.ts", (text) => {
  text = replaceOnce(
    text,
    `  scrollHeight: number;
}): DocumentPageMap | undefined {`,
    `  scrollHeight: number;
  declaredPageCount?: number;
}): DocumentPageMap | undefined {`,
    "declared page count input",
  );
  return replaceOnce(
    text,
    `  const declaredPageCount =
    declaredIndexes.length === 0 ? undefined : Math.max(...declaredIndexes) + 1;`,
    `  const candidateDeclaredPageCount =
    declaredIndexes.length === 0 ? undefined : Math.max(...declaredIndexes) + 1;
  const declaredPageCount =
    options.declaredPageCount !== undefined &&
    Number.isInteger(options.declaredPageCount) &&
    options.declaredPageCount > 0
      ? Math.max(options.declaredPageCount, candidateDeclaredPageCount ?? 0)
      : candidateDeclaredPageCount;`,
    "declared page count normalization",
  );
});

await edit("src/capture/capture-engine.ts", (text) => {
  text = replaceOnce(
    text,
    `  CaptureEngineKind,
  CaptureJob,`,
    `  CaptureEngineKind,
  CaptureJob,
  DocumentPageMap,`,
    "capture engine page map import",
  );
  text = replaceOnce(
    text,
    `    tiles: CaptureTile[],
    partialCapture?: PartialCapture,
  ): Promise<void>;`,
    `    tiles: CaptureTile[],
    partialCapture?: PartialCapture,
    documentPageMap?: DocumentPageMap,
  ): Promise<void>;`,
    "capture onPlan page map",
  );
  return replaceOnce(
    text,
    `  tiles: CaptureTile[];
  partialCapture?: PartialCapture;
}`,
    `  tiles: CaptureTile[];
  partialCapture?: PartialCapture;
  documentPageMap?: DocumentPageMap;
}`,
    "capture result page map",
  );
});

await edit("src/shared/contracts/scroll-area.ts", (text) => {
  text = replaceOnce(
    text,
    `  ElementTargetDescriptorSchema,
  FixedElementModeSchema,`,
    `  DocumentPageMapSchema,
  ElementTargetDescriptorSchema,
  FixedElementModeSchema,`,
    "scroll contract page map schema import",
  );
  return replaceOnce(
    text,
    `      scrollSnapped: z.boolean(),
      layoutChanged: z.boolean(),`,
    `      scrollSnapped: z.boolean(),
      layoutChanged: z.boolean(),
      documentPageMap: DocumentPageMapSchema.optional(),`,
    "scroll response page map",
  );
});

await edit("src/background/scroll-area-page-adapter.ts", (text) => {
  text = replaceOnce(
    text,
    `import type { ElementTargetDescriptor, FixedElementMode, Rect } from "@shared/contracts/domain";`,
    `import type {
  DocumentPageMap,
  ElementTargetDescriptor,
  FixedElementMode,
  Rect,
} from "@shared/contracts/domain";`,
    "scroll adapter page map import",
  );
  text = replaceOnce(
    text,
    `  scrollSnapped: boolean;
  layoutChanged: boolean;
}`,
    `  scrollSnapped: boolean;
  layoutChanged: boolean;
  documentPageMap?: DocumentPageMap;
}`,
    "scroll adapter result page map",
  );
  return replaceOnce(
    text,
    `      scrollSnapped: payload.scrollSnapped,
      layoutChanged: payload.layoutChanged,
    };`,
    `      scrollSnapped: payload.scrollSnapped,
      layoutChanged: payload.layoutChanged,
      ...(payload.documentPageMap === undefined
        ? {}
        : { documentPageMap: payload.documentPageMap }),
    };`,
    "scroll adapter return page map",
  );
});

await edit("src/content/entry.ts", (text) => {
  text = replaceOnce(
    text,
    `import type { ElementTargetDescriptor, FixedElementMode, Rect } from "@shared/contracts/domain";`,
    `import type {
  DocumentPageMap,
  ElementTargetDescriptor,
  FixedElementMode,
  Rect,
} from "@shared/contracts/domain";
import {
  buildDocumentPageMap,
  type DocumentPageCandidate,
} from "@capture/document-page-map";`,
    "content page map imports",
  );
  const helper = `
const DOCUMENT_PAGE_SELECTOR = [
  "[data-page-number]",
  "[data-page-index]",
  ".pageContainer",
  ".page-container",
  ".pdf-page",
  "viewer-pdf-page",
  "pdf-viewer-page",
].join(",");
const DOCUMENT_PAGE_SCAN_LIMIT = 50_000;

function positiveIntegerAttribute(element: Element, names: readonly string[]): number | undefined {
  for (const name of names) {
    const raw = element.getAttribute(name);
    if (raw === null) continue;
    const value = Number.parseInt(raw, 10);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return undefined;
}

function documentPageIndex(element: Element): number | undefined {
  const directIndex = positiveIntegerAttribute(element, ["data-page-index", "page-index"]);
  if (directIndex !== undefined) return directIndex;
  const pageNumber = positiveIntegerAttribute(element, ["data-page-number", "page-number"]);
  if (pageNumber !== undefined) return pageNumber - 1;
  const label = element.getAttribute("aria-label") ?? "";
  const match = /(?:page|trang)\\s*(\\d+)/iu.exec(label)?.[1];
  if (match === undefined) return undefined;
  const parsed = Number.parseInt(match, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : undefined;
}

function pageRectInsideTarget(target: HTMLElement, element: Element): Rect | undefined {
  const targetRect = target.getBoundingClientRect();
  const pageRect = element.getBoundingClientRect();
  if (pageRect.width < 96 || pageRect.height < 96) return undefined;
  return {
    x: pageRect.left - targetRect.left - target.clientLeft + target.scrollLeft,
    y: pageRect.top - targetRect.top - target.clientTop + target.scrollTop,
    width: pageRect.width,
    height: pageRect.height,
  };
}

function collectDocumentPageElements(target: HTMLElement): Element[] {
  const selected = new Set<Element>();
  const roots: Array<Element | ShadowRoot> = [target];
  let scanned = 0;
  while (roots.length > 0 && scanned < DOCUMENT_PAGE_SCAN_LIMIT) {
    const root = roots.pop();
    if (root === undefined) break;
    if (root instanceof Element && root !== target && root.matches(DOCUMENT_PAGE_SELECTOR)) {
      selected.add(root);
    }
    for (const candidate of Array.from(root.querySelectorAll(DOCUMENT_PAGE_SELECTOR))) {
      selected.add(candidate);
    }
    for (const element of Array.from(root.querySelectorAll("*"))) {
      scanned += 1;
      if (scanned >= DOCUMENT_PAGE_SCAN_LIMIT) break;
      if (element.shadowRoot?.mode === "open") roots.push(element.shadowRoot);
    }
  }

  if (selected.size < 2) {
    const canvasRoots: Array<Element | ShadowRoot> = [target];
    while (canvasRoots.length > 0 && selected.size < 10_000) {
      const root = canvasRoots.pop();
      if (root === undefined) break;
      for (const canvas of Array.from(root.querySelectorAll("canvas"))) selected.add(canvas);
      for (const element of Array.from(root.querySelectorAll("*"))) {
        if (element.shadowRoot?.mode === "open") canvasRoots.push(element.shadowRoot);
      }
    }
  }
  return [...selected];
}

function declaredDocumentPageCount(target: HTMLElement, pages: readonly Element[]): number | undefined {
  let pageCount = 0;
  const attributes = ["data-page-count", "data-pages-count", "page-count", "aria-setsize"];
  const inspect = (element: Element | null) => {
    if (element === null) return;
    pageCount = Math.max(pageCount, positiveIntegerAttribute(element, attributes) ?? 0);
  };
  inspect(target);
  for (const page of pages) inspect(page);
  let ancestor: Element | null = target;
  for (let depth = 0; depth < 8 && ancestor !== null; depth += 1) {
    inspect(ancestor);
    const root = ancestor.getRootNode();
    ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return pageCount > 0 ? pageCount : undefined;
}

function detectDocumentPageMap(target: HTMLElement): DocumentPageMap | undefined {
  const elements = collectDocumentPageElements(target);
  const candidates: DocumentPageCandidate[] = elements.flatMap((element) => {
    const rect = pageRectInsideTarget(target, element);
    return rect === undefined
      ? []
      : [
          {
            rect,
            ...(documentPageIndex(element) === undefined
              ? {}
              : { declaredIndex: documentPageIndex(element) }),
          },
        ];
  });
  return buildDocumentPageMap({
    candidates,
    scrollWidth: Math.max(1, target.scrollWidth),
    scrollHeight: Math.max(1, target.scrollHeight),
    ...(declaredDocumentPageCount(target, elements) === undefined
      ? {}
      : { declaredPageCount: declaredDocumentPageCount(target, elements) }),
  });
}

`;
  text = replaceOnce(
    text,
    `async function handleScrollAreaScroll(
  state: ElementSelectionRuntimeState,`,
    `${helper}async function handleScrollAreaScroll(
  state: ElementSelectionRuntimeState,`,
    "content page map detector",
  );
  text = replaceOnce(
    text,
    `  const actualScrollTop = Math.max(0, target.scrollTop);
  const scrollSnapped =`,
    `  const actualScrollTop = Math.max(0, target.scrollTop);
  const documentPageMap =
    request.payload.row === 0 &&
    request.payload.column === 0 &&
    request.payload.rows === 1 &&
    request.payload.columns === 1
      ? detectDocumentPageMap(target)
      : undefined;
  const scrollSnapped =`,
    "content page map measurement",
  );
  return replaceOnce(
    text,
    `    scrollSnapped,
    layoutChanged,
  });`,
    `    scrollSnapped,
    layoutChanged,
    ...(documentPageMap === undefined ? {} : { documentPageMap }),
  });`,
    "content page map response",
  );
});

await edit("src/capture/scroll-area-capture-engine.ts", (text) => {
  text = replaceOnce(
    text,
    `import { FALLBACK_OVERLAP_CSS, VISIBLE_CAPTURE_MIN_INTERVAL_MS } from "@shared/constants";
import type { CaptureTile, PageMetrics } from "@shared/contracts/domain";`,
    `import {
  FALLBACK_OVERLAP_CSS,
  PDF_VIEWER_MAX_DOCUMENT_TILES,
  VISIBLE_CAPTURE_MIN_INTERVAL_MS,
} from "@shared/constants";
import type { CaptureTile, DocumentPageMap, PageMetrics } from "@shared/contracts/domain";`,
    "scroll engine PDF imports",
  );
  text = replaceOnce(
    text,
    `    const metrics = metricsFromContainer(initial);

    context.cancellation.throwIfCancelled("plan");`,
    `    const metrics = metricsFromContainer(initial);
    const documentPageMap: DocumentPageMap | undefined =
      initial.documentPageMap?.complete === true && initial.documentPageMap.confidence >= 0.8
        ? initial.documentPageMap
        : undefined;

    context.cancellation.throwIfCancelled("plan");`,
    "scroll engine page map selection",
  );
  text = replaceOnce(
    text,
    `    const plan = planScrollCaptureTiles({
      jobId: context.jobId,
      targetRect,
      viewportWidthCss: initial.clientWidth,
      viewportHeightCss: initial.clientHeight,
      pixelScale: 1,
      overlapCss: this.overlapCss,
      maxTiles: context.settings.limits.maxTiles,
    });`,
    `    const planningTileLimit =
      documentPageMap === undefined
        ? context.settings.limits.maxTiles
        : PDF_VIEWER_MAX_DOCUMENT_TILES;
    const plan = planScrollCaptureTiles({
      jobId: context.jobId,
      targetRect,
      viewportWidthCss: initial.clientWidth,
      viewportHeightCss: initial.clientHeight,
      pixelScale: 1,
      overlapCss: this.overlapCss,
      maxTiles: planningTileLimit,
    });`,
    "scroll engine planning cap",
  );
  text = replaceOnce(
    text,
    `          limitValue: context.settings.limits.maxTiles,
        }
      : undefined;
    await context.onPlan(metrics, plan.targetRect, plan.tiles, partialCapture);`,
    `          limitValue: planningTileLimit,
        }
      : undefined;
    await context.onPlan(metrics, plan.targetRect, plan.tiles, partialCapture, documentPageMap);`,
    "scroll engine plan page map",
  );
  text = replaceOnce(
    text,
    `    const storedTiles: CaptureTile[] = [];
    let captureScale: CapturePixelScale | undefined;
    for (const planned of plan.tiles) {`,
    `    const storedTiles: CaptureTile[] = [];
    let captureScale: CapturePixelScale | undefined;
    const batchSize = Math.max(1, context.settings.limits.maxTiles);
    for (let batchStart = 0; batchStart < plan.tiles.length; batchStart += batchSize) {
      const batch = plan.tiles.slice(batchStart, batchStart + batchSize);
      for (const planned of batch) {`,
    "scroll engine batch loop",
  );
  text = replaceOnce(
    text,
    `        expectedScrollWidth: initial.scrollWidth,
        expectedScrollHeight: initial.scrollHeight,
        expectedClientWidth: initial.clientWidth,`,
    `        expectedScrollWidth: initial.scrollWidth,
        ...(documentPageMap === undefined
          ? { expectedScrollHeight: initial.scrollHeight }
          : {}),
        expectedClientWidth: initial.clientWidth,`,
    "scroll engine PDF height guard",
  );
  text = replaceOnce(
    text,
    `        page.layoutChanged &&
        plan.limitedByMaxTiles &&`,
    `        page.layoutChanged &&
        documentPageMap !== undefined &&`,
    "scroll engine height drift condition",
  );
  text = replaceOnce(
    text,
    `      storedTiles.push(captured);
    }

    return {
      metrics,
      targetRect: plan.targetRect,
      tiles: storedTiles,
      ...(partialCapture === undefined ? {} : { partialCapture }),
    };`,
    `      storedTiles.push(captured);
      }
    }

    return {
      metrics,
      targetRect: plan.targetRect,
      tiles: storedTiles,
      ...(partialCapture === undefined ? {} : { partialCapture }),
      ...(documentPageMap === undefined ? {} : { documentPageMap }),
    };`,
    "scroll engine batch close and result",
  );
  return text;
});

await edit("src/background/full-page-capture-coordinator.ts", (text) => {
  text = replaceOnce(
    text,
    `  CaptureJob,
  CaptureTile,
  PageMetrics,`,
    `  CaptureJob,
  CaptureTile,
  DocumentPageMap,
  PageMetrics,`,
    "coordinator page map import",
  );
  text = replaceOnce(
    text,
    `          onPlan: (metrics, targetRect, tiles, enginePartialCapture) => {`,
    `          onPlan: (
            metrics,
            targetRect,
            tiles,
            enginePartialCapture,
            documentPageMap,
          ) => {`,
    "coordinator onPlan page map",
  );
  text = replaceOnce(
    text,
    `              enginePartialCapture ?? preparationPartialCapture,
            );`,
    `              enginePartialCapture ?? preparationPartialCapture,
              documentPageMap,
            );`,
    "coordinator record page map",
  );
  text = replaceOnce(
    text,
    `    tiles: CaptureTile[],
    partialCapture?: PartialCapture,
  ): Promise<void> {`,
    `    tiles: CaptureTile[],
    partialCapture?: PartialCapture,
    documentPageMap?: DocumentPageMap,
  ): Promise<void> {`,
    "coordinator recordPlan signature",
  );
  return replaceOnce(
    text,
    `      totalTiles: tiles.length,
      ...(partialCapture === undefined ? {} : { partialCapture }),`,
    `      totalTiles: tiles.length,
      ...(partialCapture === undefined ? {} : { partialCapture }),
      ...(documentPageMap === undefined ? {} : { documentPageMap }),`,
    "coordinator persist page map",
  );
});

await edit("src/background/job-state-machine.ts", (text) => {
  text = replaceOnce(
    text,
    `    | "targetDescriptor"
    | "tilePlan"`,
    `    | "targetDescriptor"
    | "documentPageMap"
    | "tilePlan"`,
    "job patch page map",
  );
  const invariant = `
  if (job.documentPageMap !== undefined) {
    const pageMap = job.documentPageMap;
    if (job.mode !== "scroll-area") {
      return err(
        stateError("Only scroll-area jobs may persist a document page map.", "DocumentPageModeMismatch", {
          mode: job.mode,
        }),
      );
    }
    if (pageMap.pages.length !== pageMap.sourcePageCount) {
      return err(
        stateError("Document page count must match the page map.", "DocumentPageCountMismatch", {
          sourcePageCount: pageMap.sourcePageCount,
          mappedPages: pageMap.pages.length,
        }),
      );
    }
    for (const [index, page] of pageMap.pages.entries()) {
      if (page.index !== index || page.sourceRectCss.width <= 0 || page.sourceRectCss.height <= 0) {
        return err(
          stateError("Document pages must be sequential and non-empty.", "DocumentPageMapInvalid", {
            expectedIndex: index,
            pageIndex: page.index,
          }),
        );
      }
    }
  }

`;
  text = replaceOnce(
    text,
    `  if (job.adaptiveFrontier !== undefined) {`,
    `${invariant}  if (job.adaptiveFrontier !== undefined) {`,
    "document page map invariants",
  );
  const outputInvariant = `
  if (
    job.documentPageMap?.complete === true &&
    job.partialCapture === undefined &&
    job.activeOutputFormat === "pdf" &&
    job.exportProgress !== undefined &&
    job.exportProgress.totalPages !== job.documentPageMap.sourcePageCount
  ) {
    return err(
      stateError(
        "Dedicated PDF output progress must match the detected source page count.",
        "PdfSourcePageCountMismatch",
        {
          sourcePageCount: job.documentPageMap.sourcePageCount,
          outputPages: job.exportProgress.totalPages,
        },
      ),
    );
  }

  if (
    job.state === "completed" &&
    job.documentPageMap?.complete === true &&
    job.partialCapture === undefined &&
    job.activeOutputFormat === "pdf" &&
    job.output?.pageCount !== job.documentPageMap.sourcePageCount
  ) {
    return err(
      stateError(
        "A completed dedicated PDF must contain every detected source page.",
        "PdfCompletedPageCountMismatch",
        {
          sourcePageCount: job.documentPageMap.sourcePageCount,
          outputPages: job.output?.pageCount ?? 0,
        },
      ),
    );
  }

`;
  return replaceOnce(
    text,
    `  if (
    job.output !== undefined &&`,
    `${outputInvariant}  if (
    job.output !== undefined &&`,
    "PDF source page invariants",
  );
});

await edit("src/shared/contracts/job.ts", (text) => {
  text = replaceOnce(
    text,
    `    completedTiles: NonNegativeIntegerSchema,
    totalTiles: NonNegativeIntegerSchema,`,
    `    completedTiles: NonNegativeIntegerSchema,
    totalTiles: NonNegativeIntegerSchema,
    completedDocumentPages: NonNegativeIntegerSchema.optional(),
    totalDocumentPages: NonNegativeIntegerSchema.optional(),`,
    "job summary document progress schema",
  );
  text = replaceOnce(
    text,
    `export function summarizeJob(job: CaptureJob): JobSummary {
  return JobSummarySchema.parse({`,
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
  ).length;
  return JobSummarySchema.parse({`,
    "job summary document progress calculation",
  );
  return replaceOnce(
    text,
    `    completedTiles: job.completedTiles,
    totalTiles: job.totalTiles,
    updatedAt: job.updatedAt,`,
    `    completedTiles: job.completedTiles,
    totalTiles: job.totalTiles,
    ...(completedDocumentPages === undefined
      ? {}
      : { completedDocumentPages }),
    ...(job.documentPageMap === undefined
      ? {}
      : { totalDocumentPages: job.documentPageMap.sourcePageCount }),
    updatedAt: job.updatedAt,`,
    "job summary document progress payload",
  );
});

await edit("src/offscreen/pdf-layout.ts", (text) => {
  text = replaceOnce(
    text,
    `import type { CaptureSettings, Rect } from "@shared/contracts/domain";`,
    `import type { CaptureSettings, DocumentPageMap, Rect } from "@shared/contracts/domain";`,
    "PDF layout page map import",
  );
  const addition = `
export function planPdfDocumentPages(
  pageMap: DocumentPageMap,
  settings: CaptureSettings["pdf"],
): PdfPageSlice[] {
  if (pageMap.pages.length === 0 || pageMap.pages.length !== pageMap.sourcePageCount) {
    throw new RangeError("Document page map must contain every source page.");
  }
  return pageMap.pages.map((documentPage, index) => {
    const source = documentPage.sourceRectCss;
    const orientation = source.width > source.height ? "landscape" : "portrait";
    const pageBox = resolvePdfPageBox({ ...settings, orientation }, source.width);
    const scalePtPerCss = Math.min(
      pageBox.printableWidthPt / positive(source.width, "PDF source page width"),
      pageBox.printableHeightPt / positive(source.height, "PDF source page height"),
    );
    const imageWidthPt = source.width * scalePtPerCss;
    const imageHeightPt = source.height * scalePtPerCss;
    return {
      index,
      sourceRectCss: source,
      pageWidthPt: pageBox.widthPt,
      pageHeightPt: pageBox.heightPt,
      imageRectPt: {
        x: pageBox.marginLeftPt + (pageBox.printableWidthPt - imageWidthPt) / 2,
        y: pageBox.marginBottomPt + (pageBox.printableHeightPt - imageHeightPt) / 2,
        width: imageWidthPt,
        height: imageHeightPt,
      },
    };
  });
}

`;
  return replaceOnce(
    text,
    `export function createRunningPixelRanges(`,
    `${addition}export function createRunningPixelRanges(`,
    "logical PDF pages planner",
  );
});

await edit("src/background/pdf-export-service.ts", (text) => {
  text = replaceOnce(
    text,
    `import { planPdfDocument } from "@offscreen/pdf-layout";`,
    `import { planPdfDocument, planPdfDocumentPages } from "@offscreen/pdf-layout";`,
    "PDF export logical pages import",
  );
  const helper = `
function mappedEditorPages(
  job: CaptureJob,
  settings: CaptureSettings["pdf"],
): PdfEditorPage[] | undefined {
  const pageMap = job.documentPageMap;
  const target = job.targetRect;
  if (pageMap === undefined || target === undefined) return undefined;
  const right = target.x + target.width;
  const bottom = target.y + target.height;
  const pages = pageMap.pages.filter((page) => {
    const rect = page.sourceRectCss;
    return (
      rect.x >= target.x - 0.01 &&
      rect.y >= target.y - 0.01 &&
      rect.x + rect.width <= right + 0.01 &&
      rect.y + rect.height <= bottom + 0.01
    );
  });
  if (pages.length === 0) return [];
  return planPdfDocumentPages(
    {
      ...pageMap,
      complete: pages.length === pageMap.sourcePageCount,
      sourcePageCount: pages.length,
      pages: pages.map((page, index) => ({ ...page, index })),
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

`;
  text = replaceOnce(
    text,
    `export class PdfExportService {`,
    `${helper}export class PdfExportService {`,
    "PDF export mapped page helper",
  );
  return replaceOnce(
    text,
    `    const manifest = settings === undefined ? await this.manifests?.load(jobId) : undefined;
    const pdfSettings = settings ?? manifest?.settings ?? current.settings.pdf;
    const pages = manifest?.pages;
    const totalPages =
      pages?.length ?? planPdfDocument(current.targetRect, pdfSettings).pages.length;`,
    `    const manifest = settings === undefined ? await this.manifests?.load(jobId) : undefined;
    const pdfSettings = settings ?? manifest?.settings ?? current.settings.pdf;
    const pages = manifest?.pages ?? mappedEditorPages(current, pdfSettings);
    if (pages !== undefined && pages.length === 0) {
      throw exportSourceError(jobId, "PdfDocumentPagesUnavailable");
    }
    const totalPages =
      pages?.length ?? planPdfDocument(current.targetRect, pdfSettings).pages.length;`,
    "PDF export mapped pages selection",
  );
});

await edit("src/offscreen/pdf-exporter.ts", (text) => {
  text = replaceOnce(
    text,
    `    const totalPixelHeight = Math.max(1, Math.round(payload.targetRect.height * renderScaleY));
    const canvasWidth = Math.max(1, Math.round(payload.targetRect.width * renderScaleX));
    const pagePixelRanges = pages.map((page) => {
      const pixelRange = roundRange(
        (page.sourceRectCss.y - payload.targetRect.y) * renderScaleY,
        (page.sourceRectCss.y + page.sourceRectCss.height - payload.targetRect.y) * renderScaleY,
        totalPixelHeight,
      );
      if (pixelRange.length <= 0) {
        throw exportError("PDF page pixel range is empty.", "PdfPagePixelRangeMissing");
      }
      return { page, pixelRange };
    });
    const maxPagePixelArea = Math.max(
      ...pagePixelRanges.map(({ pixelRange }) => canvasWidth * pixelRange.length),
    );`,
    `    const totalPixelWidth = Math.max(1, Math.round(payload.targetRect.width * renderScaleX));
    const totalPixelHeight = Math.max(1, Math.round(payload.targetRect.height * renderScaleY));
    const pagePixelRanges = pages.map((page) => {
      const pixelXRange = roundRange(
        (page.sourceRectCss.x - payload.targetRect.x) * renderScaleX,
        (page.sourceRectCss.x + page.sourceRectCss.width - payload.targetRect.x) * renderScaleX,
        totalPixelWidth,
      );
      const pixelYRange = roundRange(
        (page.sourceRectCss.y - payload.targetRect.y) * renderScaleY,
        (page.sourceRectCss.y + page.sourceRectCss.height - payload.targetRect.y) * renderScaleY,
        totalPixelHeight,
      );
      if (pixelXRange.length <= 0 || pixelYRange.length <= 0) {
        throw exportError("PDF page pixel range is empty.", "PdfPagePixelRangeMissing");
      }
      return { page, pixelXRange, pixelYRange };
    });
    const maxPagePixelArea = Math.max(
      ...pagePixelRanges.map(
        ({ pixelXRange, pixelYRange }) => pixelXRange.length * pixelYRange.length,
      ),
    );`,
    "PDF exporter two-axis page crop planning",
  );
  text = replaceOnce(
    text,
    `      widthCss: payload.targetRect.width,
      heightCss: payload.targetRect.height,`,
    `      widthCss: Math.max(...pages.map((page) => page.sourceRectCss.width)),
      heightCss: payload.targetRect.height,`,
    "PDF exporter mapped page memory width",
  );
  text = replaceOnce(
    text,
    `      for (const [outputIndex, entry] of pagePixelRanges.entries()) {
        const { page, pixelRange } = entry;
        const canvas = this.environment.createCanvas(canvasWidth, pixelRange.length);`,
    `      for (const [outputIndex, entry] of pagePixelRanges.entries()) {
        const { page, pixelXRange, pixelYRange } = entry;
        const canvas = this.environment.createCanvas(pixelXRange.length, pixelYRange.length);`,
    "PDF exporter mapped page canvas",
  );
  text = replaceOnce(
    text,
    `                canvasWidth,
              );
              const globalDestinationY = roundRange(`,
    `                totalPixelWidth,
              );
              const destinationX = globalDestinationX.start - pixelXRange.start;
              const globalDestinationY = roundRange(`,
    "PDF exporter x destination origin",
  );
  text = replaceOnce(
    text,
    `              const destinationY = globalDestinationY.start - pixelRange.start;
              if (
                sourceX.length <= 0 ||
                sourceY.length <= 0 ||
                globalDestinationX.length <= 0 ||
                globalDestinationY.length <= 0 ||
                destinationY < 0 ||
                destinationY + globalDestinationY.length > canvas.height`,
    `              const destinationY = globalDestinationY.start - pixelYRange.start;
              if (
                sourceX.length <= 0 ||
                sourceY.length <= 0 ||
                globalDestinationX.length <= 0 ||
                globalDestinationY.length <= 0 ||
                destinationX < 0 ||
                destinationX + globalDestinationX.length > canvas.width ||
                destinationY < 0 ||
                destinationY + globalDestinationY.length > canvas.height`,
    "PDF exporter page-local destinations",
  );
  return replaceOnce(
    text,
    `                globalDestinationX.start,
                destinationY,`,
    `                destinationX,
                destinationY,`,
    "PDF exporter page-local draw x",
  );
});

await edit("tests/unit/pdf-layout.test.ts", (text) => {
  text = replaceOnce(
    text,
    `  planPdfDocument,
  resolvePdfPageBox,`,
    `  planPdfDocument,
  planPdfDocumentPages,
  resolvePdfPageBox,`,
    "PDF layout logical planner test import",
  );
  const test = `
  it("keeps one output page per detected source page without splitting", () => {
    const pages = planPdfDocumentPages(
      {
        schemaVersion: 1,
        strategy: "dom",
        confidence: 1,
        complete: true,
        sourcePageCount: 2,
        pages: [
          { index: 0, sourceRectCss: { x: 120, y: 20, width: 800, height: 1132 } },
          { index: 1, sourceRectCss: { x: 40, y: 1180, width: 1132, height: 800 } },
        ],
      },
      DEFAULT_CAPTURE_SETTINGS.pdf,
    );

    expect(pages).toHaveLength(2);
    expect(pages[0]?.sourceRectCss).toEqual({ x: 120, y: 20, width: 800, height: 1132 });
    expect(pages[1]?.sourceRectCss).toEqual({ x: 40, y: 1180, width: 1132, height: 800 });
    expect(pages[0]?.pageHeightPt).toBeGreaterThan(pages[0]?.pageWidthPt ?? 0);
    expect(pages[1]?.pageWidthPt).toBeGreaterThan(pages[1]?.pageHeightPt ?? 0);
    expect(pages.every((page) => page.imageRectPt.width > 0 && page.imageRectPt.height > 0)).toBe(
      true,
    );
  });

`;
  return replaceOnce(
    text,
    `  it("carries fractional pixel residuals and reaches the exact final pixel", () => {`,
    `${test}  it("carries fractional pixel residuals and reaches the exact final pixel", () => {`,
    "PDF layout logical pages test",
  );
});

await edit("tests/unit/scroll-area-capture-engine.test.ts", (text) => {
  const test = `
  it("captures a detected 126-page PDF in automatic batches beyond maxTiles", async () => {
    const harness = setup();
    const sourcePageCount = 126;
    const scrollHeight = sourcePageCount * 200;
    const documentPageMap = {
      schemaVersion: 1 as const,
      strategy: "dom" as const,
      confidence: 1,
      complete: true,
      sourcePageCount,
      pages: Array.from({ length: sourcePageCount }, (_, index) => ({
        index,
        sourceRectCss: { x: 0, y: index * 200, width: 100, height: 180 },
      })),
    };
    harness.context.settings = {
      ...harness.context.settings,
      limits: { ...harness.context.settings.limits, maxTiles: 256 },
    };
    harness.scrollAndSettle.mockImplementation((request: ScrollAreaPageRequest) =>
      Promise.resolve({
        ...pageResult(request),
        scrollHeight,
        ...(request.rows === 1 && request.columns === 1 ? { documentPageMap } : {}),
      }),
    );

    const result = await harness.engine.capture(harness.context);

    expect(result.tiles.length).toBeGreaterThan(256);
    expect(result.tiles).toHaveLength(harness.stored.length);
    expect(result.partialCapture).toBeUndefined();
    expect(result.documentPageMap?.sourcePageCount).toBe(126);
    expect(harness.onPlan).toHaveBeenCalledWith(
      expect.any(Object),
      { x: 0, y: 0, width: 100, height: scrollHeight },
      expect.arrayContaining([
        expect.objectContaining({ index: 0 }),
        expect.objectContaining({ index: 256 }),
      ]),
      undefined,
      documentPageMap,
    );
  }, 30_000);

`;
  return replaceOnce(
    text,
    `  it("restores the container and document scroll state", async () => {`,
    `${test}  it("restores the container and document scroll state", async () => {`,
    "126-page batch capture regression",
  );
});

await edit("tests/unit/job-state-machine.test.ts", (text) => {
  const test = `
  it("rejects dedicated PDF export progress that omits detected source pages", () => {
    const current: CaptureJob = {
      ...job("ready"),
      mode: "scroll-area",
      preferredEngine: "scroll",
      activeEngine: "scroll",
      tilePlan: [tile("stored")],
      completedTiles: 1,
      totalTiles: 1,
      documentPageMap: {
        schemaVersion: 1,
        strategy: "dom",
        confidence: 1,
        complete: true,
        sourcePageCount: 126,
        pages: Array.from({ length: 126 }, (_, index) => ({
          index,
          sourceRectCss: { x: 0, y: index * 100, width: 100, height: 90 },
        })),
      },
    };
    const result = transitionJob(
      current,
      "exporting",
      updatedAt,
      {
        activeOutputFormat: "pdf",
        exportProgress: { completedPages: 0, totalPages: 63 },
      },
      { sourceArtifactExists: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { causeCode: "PdfSourcePageCountMismatch" },
    });
  });

`;
  return replaceOnce(
    text,
    `  it("requires normalized error and settled cleanup for failed jobs", () => {`,
    `${test}  it("requires normalized error and settled cleanup for failed jobs", () => {`,
    "job state source page count test",
  );
});

await writeFile(
  "tests/unit/document-page-map.test.ts",
  `import { describe, expect, it } from "vitest";

import { buildDocumentPageMap } from "@capture/document-page-map";

describe("document page map", () => {
  it("keeps complete explicit PDF page rectangles", () => {
    const result = buildDocumentPageMap({
      scrollWidth: 1000,
      scrollHeight: 2400,
      candidates: [
        { rect: { x: 100, y: 20, width: 800, height: 1100 }, declaredIndex: 0 },
        { rect: { x: 100, y: 1180, width: 800, height: 1100 }, declaredIndex: 1 },
      ],
      declaredPageCount: 2,
    });

    expect(result).toMatchObject({
      strategy: "dom",
      complete: true,
      sourcePageCount: 2,
      pages: [
        { index: 0, sourceRectCss: { x: 100, y: 20, width: 800, height: 1100 } },
        { index: 1, sourceRectCss: { x: 100, y: 1180, width: 800, height: 1100 } },
      ],
    });
  });

  it("projects 126 virtualized pages from a stable page rhythm", () => {
    const result = buildDocumentPageMap({
      scrollWidth: 1000,
      scrollHeight: 126 * 1200,
      declaredPageCount: 126,
      candidates: [
        { rect: { x: 100, y: 0, width: 800, height: 1100 }, declaredIndex: 0 },
        { rect: { x: 100, y: 1200, width: 800, height: 1100 }, declaredIndex: 1 },
        { rect: { x: 100, y: 2400, width: 800, height: 1100 }, declaredIndex: 2 },
      ],
    });

    expect(result).toMatchObject({
      strategy: "projected",
      complete: true,
      sourcePageCount: 126,
    });
    expect(result?.pages).toHaveLength(126);
    expect(result?.pages.at(-1)?.index).toBe(125);
  });

  it("rejects irregular non-document candidates instead of guessing", () => {
    const result = buildDocumentPageMap({
      scrollWidth: 1200,
      scrollHeight: 8000,
      candidates: [
        { rect: { x: 20, y: 100, width: 300, height: 400 } },
        { rect: { x: 500, y: 900, width: 650, height: 900 } },
        { rect: { x: 50, y: 2800, width: 1000, height: 300 } },
      ],
    });

    expect(result).toBeUndefined();
  });
});
`,
);
