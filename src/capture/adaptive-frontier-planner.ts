import { TILE_COVERAGE_EPSILON_CSS } from "@shared/constants";
import type { CaptureTile, Rect } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

export interface AdaptiveRowPlanRequest {
  jobId: string;
  nextTileIndex: number;
  row: number;
  nextYCss: number;
  documentWidthCss: number;
  documentHeightCss: number;
  viewportWidthCss: number;
  viewportHeightCss: number;
  maxCssWidth: number;
  overlapCss: number;
  remainingTiles: number;
}

export interface AdaptiveRowPlan {
  targetWidthCss: number;
  sourceYCss: number;
  outputBottomCss: number;
  columns: number;
  tiles: CaptureTile[];
  limitedByMaxTiles: boolean;
}

function planError(message: string, causeCode: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_TILE_PLAN",
      stage: "plan",
      message,
      userMessageKey: "errors.tilePlan",
      retryable: false,
      fallbackAllowed: false,
      causeCode,
    }),
  );
}

function requirePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw planError(`Adaptive capture ${name} must be a positive finite number.`, "InvalidInput");
  }
  return value;
}

function createStops(start: number, extent: number, viewportExtent: number, overlap: number): number[] {
  const maximumStart = Math.max(start, start + extent - viewportExtent);
  if (maximumStart - start <= TILE_COVERAGE_EPSILON_CSS) {
    return [start];
  }
  const safeOverlap = Math.min(Math.max(0, overlap), Math.max(0, viewportExtent - 1));
  const step = Math.max(1, viewportExtent - safeOverlap);
  const stops = [start];
  while ((stops.at(-1) ?? start) < maximumStart - TILE_COVERAGE_EPSILON_CSS) {
    const previous = stops.at(-1) ?? start;
    const next = Math.min(maximumStart, previous + step);
    if (next <= previous + TILE_COVERAGE_EPSILON_CSS) {
      break;
    }
    stops.push(next);
  }
  return stops;
}

export function planAdaptiveCaptureRow(request: AdaptiveRowPlanRequest): AdaptiveRowPlan {
  const documentWidth = requirePositive(request.documentWidthCss, "document width");
  const documentHeight = requirePositive(request.documentHeightCss, "document height");
  const viewportWidth = requirePositive(request.viewportWidthCss, "viewport width");
  const viewportHeight = requirePositive(request.viewportHeightCss, "viewport height");
  const maxCssWidth = requirePositive(request.maxCssWidth, "maximum CSS width");
  const remainingTiles = Math.max(0, Math.floor(request.remainingTiles));
  const nextY = Math.max(0, request.nextYCss);
  if (nextY >= documentHeight - TILE_COVERAGE_EPSILON_CSS) {
    return {
      targetWidthCss: Math.min(documentWidth, maxCssWidth),
      sourceYCss: Math.max(0, documentHeight - viewportHeight),
      outputBottomCss: documentHeight,
      columns: 0,
      tiles: [],
      limitedByMaxTiles: false,
    };
  }

  const targetWidth = Math.min(documentWidth, maxCssWidth);
  const overlap = Number.isFinite(request.overlapCss) ? Math.max(0, request.overlapCss) : 0;
  const xStops = createStops(0, targetWidth, viewportWidth, overlap);
  if (xStops.length > remainingTiles) {
    return {
      targetWidthCss: targetWidth,
      sourceYCss: Math.max(0, Math.min(nextY - overlap, documentHeight - viewportHeight)),
      outputBottomCss: nextY,
      columns: xStops.length,
      tiles: [],
      limitedByMaxTiles: true,
    };
  }

  const sourceY = Math.max(0, Math.min(nextY - overlap, documentHeight - viewportHeight));
  const outputBottom = Math.min(documentHeight, sourceY + viewportHeight);
  if (outputBottom <= nextY + TILE_COVERAGE_EPSILON_CSS) {
    throw planError("Adaptive capture could not create a non-empty next row.", "EmptyAdaptiveRow");
  }

  const tiles: CaptureTile[] = [];
  for (let column = 0; column < xStops.length; column += 1) {
    const scrollX = xStops[column] as number;
    const previousRight = column === 0 ? 0 : (xStops[column - 1] as number) + viewportWidth;
    const outputX = Math.max(0, previousRight, scrollX);
    const outputRight = Math.min(targetWidth, scrollX + viewportWidth);
    const index = request.nextTileIndex + column;
    const sourceRectCss: Rect = {
      x: scrollX,
      y: sourceY,
      width: viewportWidth,
      height: viewportHeight,
    };
    const outputRectCss: Rect = {
      x: outputX,
      y: nextY,
      width: outputRight - outputX,
      height: outputBottom - nextY,
    };
    if (outputRectCss.width <= 0 || outputRectCss.height <= 0) {
      throw planError("Adaptive capture produced an empty output tile.", "EmptyAdaptiveTile");
    }
    tiles.push({
      id: `${request.jobId}:${index}`,
      jobId: request.jobId,
      index,
      row: request.row,
      column,
      sourceRectCss,
      outputRectCss,
      scrollXCss: scrollX,
      scrollYCss: sourceY,
      expectedPixelWidth: Math.max(1, Math.round(viewportWidth)),
      expectedPixelHeight: Math.max(1, Math.round(viewportHeight)),
      overlapTopCss: Math.max(0, nextY - sourceY),
      overlapLeftCss: Math.max(0, outputX - scrollX),
      overlapRightCss: Math.max(0, scrollX + viewportWidth - outputRight),
      overlapBottomCss: Math.max(0, sourceY + viewportHeight - outputBottom),
      status: "planned",
      attempts: 0,
    });
  }

  return {
    targetWidthCss: targetWidth,
    sourceYCss: sourceY,
    outputBottomCss: outputBottom,
    columns: xStops.length,
    tiles,
    limitedByMaxTiles: false,
  };
}
