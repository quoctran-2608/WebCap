import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

import { inspectPdfIntegrity, type PdfExpectedPageSize } from "./pdf-integrity";
import { planPdfDocument } from "./pdf-layout";
import { assertPdfExportMemorySafe, type PdfMemoryEstimate } from "./pdf-memory-guard";
import type {
  PdfExporter,
  PdfExportPayload,
  PdfExportProgress,
  PdfExportResult,
  PdfExportDiagnostics,
} from "./pdf-exporter";

export interface PdfExportRunner {
  export(
    payload: PdfExportPayload,
    reportProgress?: (progress: PdfExportProgress) => Promise<boolean>,
  ): Promise<PdfExportResult>;
}

export interface PdfRuntimeMemorySnapshot {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface PdfExportSupervisorEnvironment {
  now(): number;
  memory(): PdfRuntimeMemorySnapshot | undefined;
}

export interface PdfSupervisedExportDiagnostics extends PdfExportDiagnostics {
  durationMs: number;
  artifactBytes: number;
  tileBytes: number;
  estimatedPeakWorkingSetBytes: number;
  memoryThresholdBytes: number;
  integrityImageObjectCount: number;
  integrityNonEmptyStreamCount: number;
  heapBeforeBytes?: number | undefined;
  heapAfterBytes?: number | undefined;
  heapPeakBytes?: number | undefined;
}

export interface PdfSupervisedExportResult extends Omit<PdfExportResult, "diagnostics"> {
  diagnostics: PdfSupervisedExportDiagnostics;
}

export interface PdfExportSupervisorOptions {
  exporter: PdfExportRunner | PdfExporter;
  tiles: TileRepositoryPort;
  artifacts: ArtifactRepositoryPort;
  environment?: PdfExportSupervisorEnvironment | undefined;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize?: unknown;
    jsHeapSizeLimit?: unknown;
  };
}

const defaultEnvironment: PdfExportSupervisorEnvironment = {
  now: () => performance.now(),
  memory: () => {
    const memory = (performance as PerformanceWithMemory).memory;
    if (
      memory === undefined ||
      typeof memory.usedJSHeapSize !== "number" ||
      !Number.isFinite(memory.usedJSHeapSize) ||
      memory.usedJSHeapSize < 0 ||
      typeof memory.jsHeapSizeLimit !== "number" ||
      !Number.isFinite(memory.jsHeapSizeLimit) ||
      memory.jsHeapSizeLimit <= 0
    ) {
      return undefined;
    }
    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
    };
  },
};

function positiveScale(value: number, axis: "x" | "y"): number {
  if (!Number.isFinite(value) || value <= 0 || value > 8) {
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_EXPORT_FAILED",
        stage: "export",
        message: `The PDF ${axis}-axis render scale is invalid.`,
        userMessageKey: "errors.exportFailed",
        retryable: true,
        fallbackAllowed: false,
        causeCode: "InvalidPdfTileScale",
      }),
    );
  }
  return value;
}

function pagesFor(payload: PdfExportPayload) {
  return (
    payload.pages ??
    planPdfDocument(payload.targetRect, payload.settings).pages.map((page) => ({
      id: `page-${page.index + 1}`,
      originalIndex: page.index,
      sourceRectCss: page.sourceRectCss,
      pageWidthPt: page.pageWidthPt,
      pageHeightPt: page.pageHeightPt,
      imageRectPt: page.imageRectPt,
    }))
  );
}

function memoryEstimate(
  payload: PdfExportPayload,
  tileBytes: number,
  heapLimitBytes: number | undefined,
): { estimate: PdfMemoryEstimate; expectedPageSizes: PdfExpectedPageSize[] } {
  const firstTile = payload.tiles[0];
  if (firstTile === undefined) {
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_EXPORT_FAILED",
        stage: "export",
        message: "PDF export requires at least one source tile.",
        userMessageKey: "errors.exportFailed",
        retryable: true,
        fallbackAllowed: false,
        causeCode: "PdfTilesMissing",
      }),
    );
  }

  const pages = pagesFor(payload);
  const renderScaleX = positiveScale(
    firstTile.expectedPixelWidth / firstTile.sourceRectCss.width,
    "x",
  );
  const renderScaleY = positiveScale(
    firstTile.expectedPixelHeight / firstTile.sourceRectCss.height,
    "y",
  );
  const canvasWidth = Math.max(1, Math.round(payload.targetRect.width * renderScaleX));
  const maxPagePixelArea = Math.max(
    1,
    ...pages.map(
      (page) =>
        canvasWidth * Math.max(1, Math.round(page.sourceRectCss.height * renderScaleY)),
    ),
  );
  const largestTilePixelArea = Math.max(
    1,
    ...payload.tiles.map((tile) => tile.expectedPixelWidth * tile.expectedPixelHeight),
  );
  const estimate = assertPdfExportMemorySafe({
    widthCss: payload.targetRect.width,
    heightCss: payload.targetRect.height,
    renderScaleX,
    renderScaleY,
    tileCount: payload.tiles.length,
    tileBytes,
    pageCount: pages.length,
    maxPagePixelArea,
    largestTilePixelArea,
    jpegQuality: payload.settings.jpegQuality,
    ...(heapLimitBytes === undefined ? {} : { heapLimitBytes }),
  });
  return {
    estimate,
    expectedPageSizes: pages.map((page) => ({
      widthPt: page.pageWidthPt,
      heightPt: page.pageHeightPt,
    })),
  };
}

function integrityError(errors: string[]): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message:
        "The generated PDF did not pass the local integrity check. Retry export from the saved source tiles; if the issue repeats, reduce quality or split the selected pages.",
      userMessageKey: "errors.exportFailed",
      retryable: true,
      fallbackAllowed: true,
      causeCode: "PdfIntegrityCheckFailed",
      safeContext: {
        integrityErrors: errors.join(",").slice(0, 240),
        alternatives: "retry-export,lower-quality,split-output",
      },
    }),
  );
}

export class PdfExportSupervisor {
  private readonly exporter: PdfExportRunner;
  private readonly tiles: TileRepositoryPort;
  private readonly artifacts: ArtifactRepositoryPort;
  private readonly environment: PdfExportSupervisorEnvironment;

  constructor(options: PdfExportSupervisorOptions) {
    this.exporter = options.exporter;
    this.tiles = options.tiles;
    this.artifacts = options.artifacts;
    this.environment = options.environment ?? defaultEnvironment;
  }

  async export(
    payload: PdfExportPayload,
    reportProgress: (progress: PdfExportProgress) => Promise<boolean> = () =>
      Promise.resolve(true),
  ): Promise<PdfSupervisedExportResult> {
    const records = await this.tiles.listByJob(payload.jobId);
    const tileIndexes = new Set(payload.tiles.map((tile) => tile.index));
    const tileBytes = records.reduce(
      (total, record) => total + (tileIndexes.has(record.index) ? record.blob.size : 0),
      0,
    );
    const before = this.environment.memory();
    const { estimate, expectedPageSizes } = memoryEstimate(
      payload,
      tileBytes,
      before?.jsHeapSizeLimit,
    );
    const startedAt = this.environment.now();
    let heapPeakBytes = before?.usedJSHeapSize;

    const sampleHeap = () => {
      const sample = this.environment.memory()?.usedJSHeapSize;
      if (sample !== undefined) heapPeakBytes = Math.max(heapPeakBytes ?? 0, sample);
    };

    const result = await this.exporter.export(payload, async (progress) => {
      sampleHeap();
      return reportProgress(progress);
    });
    sampleHeap();

    const artifact = await this.artifacts.get(result.artifact.artifactId);
    if (artifact?.blob === undefined || artifact.blob.size <= 0) {
      throw integrityError(["artifact-missing"]);
    }
    const integrity = await inspectPdfIntegrity(await artifact.blob.arrayBuffer(), {
      pageCount: expectedPageSizes.length,
      pageSizes: expectedPageSizes,
    });
    if (!integrity.valid) {
      await this.artifacts.delete(result.artifact.artifactId).catch(() => false);
      throw integrityError(integrity.errors);
    }

    const after = this.environment.memory();
    if (after !== undefined) heapPeakBytes = Math.max(heapPeakBytes ?? 0, after.usedJSHeapSize);
    const durationMs = Math.max(0, this.environment.now() - startedAt);

    return {
      artifact: result.artifact,
      diagnostics: {
        ...result.diagnostics,
        durationMs,
        artifactBytes: artifact.blob.size,
        tileBytes,
        estimatedPeakWorkingSetBytes: estimate.estimatedWorkingSetBytes,
        memoryThresholdBytes: estimate.thresholdBytes,
        integrityImageObjectCount: integrity.imageObjectCount,
        integrityNonEmptyStreamCount: integrity.nonEmptyStreamCount,
        ...(before === undefined ? {} : { heapBeforeBytes: before.usedJSHeapSize }),
        ...(after === undefined ? {} : { heapAfterBytes: after.usedJSHeapSize }),
        ...(heapPeakBytes === undefined ? {} : { heapPeakBytes }),
      },
    };
  }
}
