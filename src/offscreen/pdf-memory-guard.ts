import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

const MEBIBYTE = 1_024 * 1_024;
const DEFAULT_HEAP_LIMIT_BYTES = 512 * MEBIBYTE;
const MAX_ESTIMATED_WORKING_SET_BYTES = 512 * MEBIBYTE;
const HEAP_BUDGET_FRACTION = 0.6;
const FIXED_EXPORT_OVERHEAD_BYTES = 32 * MEBIBYTE;
const MAX_TOTAL_PIXELS = 1_500_000_000;
const MAX_TILE_COUNT = 4_096;
const MAX_TILE_BYTES = 1_500 * MEBIBYTE;

export type PdfMemoryAlternative = "lower-quality" | "split-output" | "multi-page-pdf";

export interface PdfMemoryGuardInput {
  widthCss: number;
  heightCss: number;
  renderScaleX: number;
  renderScaleY: number;
  tileCount: number;
  tileBytes: number;
  pageCount: number;
  maxPagePixelArea: number;
  largestTilePixelArea: number;
  jpegQuality: number;
  heapLimitBytes?: number | undefined;
}

export interface PdfMemoryEstimate {
  totalPixels: number;
  estimatedPageRgbaBytes: number;
  estimatedDecodedTileBytes: number;
  estimatedEncodedPageBytes: number;
  estimatedWorkingSetBytes: number;
  thresholdBytes: number;
  shouldBlock: boolean;
  reasons: string[];
  alternatives: PdfMemoryAlternative[];
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number.`);
  }
  return value;
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite positive number.`);
  }
  return value;
}

function integerNonNegative(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function encodedPageRatio(jpegQuality: number): number {
  const quality = Math.min(1, Math.max(0, jpegQuality));
  return 0.08 + quality * 0.22;
}

export function estimatePdfExportMemory(input: PdfMemoryGuardInput): PdfMemoryEstimate {
  const widthCss = finitePositive(input.widthCss, "widthCss");
  const heightCss = finitePositive(input.heightCss, "heightCss");
  const renderScaleX = finitePositive(input.renderScaleX, "renderScaleX");
  const renderScaleY = finitePositive(input.renderScaleY, "renderScaleY");
  const tileCount = integerNonNegative(input.tileCount, "tileCount");
  const tileBytes = finiteNonNegative(input.tileBytes, "tileBytes");
  const pageCount = integerNonNegative(input.pageCount, "pageCount");
  const maxPagePixelArea = finitePositive(input.maxPagePixelArea, "maxPagePixelArea");
  const largestTilePixelArea = finitePositive(
    input.largestTilePixelArea,
    "largestTilePixelArea",
  );
  const jpegQuality = finiteNonNegative(input.jpegQuality, "jpegQuality");
  const heapLimitBytes =
    input.heapLimitBytes === undefined
      ? DEFAULT_HEAP_LIMIT_BYTES
      : finitePositive(input.heapLimitBytes, "heapLimitBytes");

  const totalPixels =
    Math.ceil(widthCss * renderScaleX) * Math.ceil(heightCss * renderScaleY);
  const estimatedPageRgbaBytes = Math.ceil(maxPagePixelArea * 4);
  const estimatedDecodedTileBytes = Math.ceil(largestTilePixelArea * 4);
  const estimatedEncodedPageBytes = Math.ceil(
    estimatedPageRgbaBytes * encodedPageRatio(jpegQuality),
  );
  const estimatedWorkingSetBytes =
    estimatedPageRgbaBytes +
    estimatedDecodedTileBytes +
    estimatedEncodedPageBytes +
    FIXED_EXPORT_OVERHEAD_BYTES;
  const thresholdBytes = Math.min(
    MAX_ESTIMATED_WORKING_SET_BYTES,
    Math.floor(heapLimitBytes * HEAP_BUDGET_FRACTION),
  );

  const reasons: string[] = [];
  if (estimatedWorkingSetBytes > thresholdBytes) reasons.push("working-set");
  if (totalPixels > MAX_TOTAL_PIXELS) reasons.push("total-pixels");
  if (tileCount > MAX_TILE_COUNT) reasons.push("tile-count");
  if (tileBytes > MAX_TILE_BYTES) reasons.push("tile-bytes");
  if (pageCount <= 0) reasons.push("page-count");

  return {
    totalPixels,
    estimatedPageRgbaBytes,
    estimatedDecodedTileBytes,
    estimatedEncodedPageBytes,
    estimatedWorkingSetBytes,
    thresholdBytes,
    shouldBlock: reasons.length > 0,
    reasons,
    alternatives: ["lower-quality", "split-output", "multi-page-pdf"],
  };
}

export function assertPdfExportMemorySafe(
  input: PdfMemoryGuardInput,
): PdfMemoryEstimate {
  const estimate = estimatePdfExportMemory(input);
  if (!estimate.shouldBlock) return estimate;

  throw createWebCapRuntimeError(
    createWebCapError({
      code: "E_MEMORY_GUARD",
      stage: "export",
      message:
        "The PDF export estimate exceeds the safe local memory budget. Reduce JPEG quality, split the output, or keep a smaller multi-page PDF selection before retrying.",
      userMessageKey: "errors.memoryGuard",
      retryable: true,
      fallbackAllowed: true,
      causeCode: "PdfWorkingSetEstimateExceeded",
      safeContext: {
        reasons: estimate.reasons.join(","),
        totalPixels: estimate.totalPixels,
        tileCount: input.tileCount,
        tileBytes: input.tileBytes,
        pageCount: input.pageCount,
        estimatedWorkingSetBytes: estimate.estimatedWorkingSetBytes,
        thresholdBytes: estimate.thresholdBytes,
        alternatives: estimate.alternatives.join(","),
      },
    }),
  );
}
