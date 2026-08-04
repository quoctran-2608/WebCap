import {
  TILE_COVERAGE_EPSILON_CSS,
  TILE_MAX_PIXEL_AREA,
  TILE_TARGET_HEIGHT_CSS,
  TILE_TARGET_WIDTH_CSS,
} from "@shared/constants";
import type { CaptureTile, Rect } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

export interface TilePlannerLimits {
  maxTileWidthCss?: number;
  maxTileHeightCss?: number;
  maxTilePixelArea?: number;
  maxTiles: number;
}

export interface TilePlanRequest {
  jobId: string;
  documentBounds: Rect;
  targetRect: Rect;
  pixelScale: number;
  limits: TilePlannerLimits;
}

export interface TilePlan {
  targetRect: Rect;
  requestedTargetRect: Rect;
  rowCount: number;
  columnCount: number;
  tiles: CaptureTile[];
  limitedByMaxTiles: boolean;
}

interface AxisSegment {
  start: number;
  size: number;
}

function planError(
  message: string,
  causeCode: string,
  safeContext?: Record<string, string | number | boolean>,
): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_TILE_PLAN",
      stage: "plan",
      message,
      userMessageKey: "errors.tilePlan.invalid",
      retryable: false,
      fallbackAllowed: false,
      causeCode,
      ...(safeContext === undefined ? {} : { safeContext }),
    }),
  );
}

function isFiniteRect(rect: Rect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
}

function right(rect: Rect): number {
  return rect.x + rect.width;
}

function bottom(rect: Rect): number {
  return rect.y + rect.height;
}

export function clampRectToBounds(targetRect: Rect, documentBounds: Rect): Rect {
  if (
    !isFiniteRect(targetRect) ||
    !isFiniteRect(documentBounds) ||
    documentBounds.width <= 0 ||
    documentBounds.height <= 0
  ) {
    throw planError("Tile planning requires finite positive document bounds.", "InvalidBounds");
  }

  const x = Math.max(targetRect.x, documentBounds.x);
  const y = Math.max(targetRect.y, documentBounds.y);
  const clampedRight = Math.min(right(targetRect), right(documentBounds));
  const clampedBottom = Math.min(bottom(targetRect), bottom(documentBounds));
  const width = clampedRight - x;
  const height = clampedBottom - y;

  if (width <= TILE_COVERAGE_EPSILON_CSS || height <= TILE_COVERAGE_EPSILON_CSS) {
    throw planError("The capture target does not intersect the document.", "EmptyTarget");
  }

  return { x, y, width, height };
}

function expectedPixels(cssLength: number, pixelScale: number): number {
  return Math.max(1, Math.ceil(cssLength * pixelScale - TILE_COVERAGE_EPSILON_CSS));
}

function axisSegments(start: number, length: number, maxSegmentSize: number): AxisSegment[] {
  const segments: AxisSegment[] = [];
  const end = start + length;
  let cursor = start;

  while (end - cursor > TILE_COVERAGE_EPSILON_CSS) {
    const remaining = end - cursor;
    const size = Math.min(maxSegmentSize, remaining);
    if (!Number.isFinite(size) || size <= TILE_COVERAGE_EPSILON_CSS) {
      throw planError("Tile segmentation produced a zero-sized segment.", "ZeroSizedTile");
    }
    segments.push({ start: cursor, size });
    cursor += size;
  }

  return segments;
}

function resolveTileSize(
  targetRect: Rect,
  pixelScale: number,
  limits: TilePlannerLimits,
): { width: number; height: number } {
  const maxTileWidthCss = limits.maxTileWidthCss ?? TILE_TARGET_WIDTH_CSS;
  const maxTileHeightCss = limits.maxTileHeightCss ?? TILE_TARGET_HEIGHT_CSS;
  const maxTilePixelArea = limits.maxTilePixelArea ?? TILE_MAX_PIXEL_AREA;

  if (
    !Number.isFinite(pixelScale) ||
    pixelScale <= 0 ||
    !Number.isFinite(maxTileWidthCss) ||
    maxTileWidthCss <= 0 ||
    !Number.isFinite(maxTileHeightCss) ||
    maxTileHeightCss <= 0 ||
    !Number.isInteger(maxTilePixelArea) ||
    maxTilePixelArea <= 0 ||
    !Number.isInteger(limits.maxTiles) ||
    limits.maxTiles <= 0
  ) {
    throw planError("Tile planner limits must be finite and positive.", "InvalidLimits");
  }

  let width = Math.min(targetRect.width, maxTileWidthCss);
  let pixelWidth = expectedPixels(width, pixelScale);
  if (pixelWidth > maxTilePixelArea) {
    pixelWidth = maxTilePixelArea;
    width = pixelWidth / pixelScale;
  }

  const maxPixelHeightByArea = Math.floor(maxTilePixelArea / pixelWidth);
  if (maxPixelHeightByArea < 1) {
    throw planError("The pixel-area guardrail cannot fit a single tile.", "PixelAreaTooSmall");
  }

  let height = Math.min(targetRect.height, maxTileHeightCss, maxPixelHeightByArea / pixelScale);

  while (
    expectedPixels(width, pixelScale) * expectedPixels(height, pixelScale) >
    maxTilePixelArea
  ) {
    height -= 1 / pixelScale;
  }

  if (width <= TILE_COVERAGE_EPSILON_CSS || height <= TILE_COVERAGE_EPSILON_CSS) {
    throw planError("The tile guardrails produced a zero-sized tile.", "ZeroSizedTile");
  }

  return { width, height };
}

export function planCaptureTiles(request: TilePlanRequest): TilePlan {
  if (request.jobId.trim().length === 0) {
    throw planError("A job ID is required to create stable tile IDs.", "MissingJobId");
  }

  const targetRect = clampRectToBounds(request.targetRect, request.documentBounds);
  const tileSize = resolveTileSize(targetRect, request.pixelScale, request.limits);
  const allColumns = axisSegments(targetRect.x, targetRect.width, tileSize.width);
  const allRows = axisSegments(targetRect.y, targetRect.height, tileSize.height);
  const tileCount = allRows.length * allColumns.length;
  const limitedByMaxTiles = tileCount > request.limits.maxTiles;
  const columnCount =
    allColumns.length <= request.limits.maxTiles ? allColumns.length : request.limits.maxTiles;
  const rowCount = limitedByMaxTiles
    ? Math.max(1, Math.floor(request.limits.maxTiles / columnCount))
    : allRows.length;
  const columns = allColumns.slice(0, columnCount);
  const rows = allRows.slice(0, rowCount);
  const limitedTargetRect: Rect = {
    x: targetRect.x,
    y: targetRect.y,
    width: columns.reduce((sum, segment) => sum + segment.size, 0),
    height: rows.reduce((sum, segment) => sum + segment.size, 0),
  };

  const tiles: CaptureTile[] = [];
  for (const [row, ySegment] of rows.entries()) {
    for (const [column, xSegment] of columns.entries()) {
      const index = row * columns.length + column;
      tiles.push({
        id: `${request.jobId}:${index}`,
        jobId: request.jobId,
        index,
        row,
        column,
        sourceRectCss: {
          x: xSegment.start,
          y: ySegment.start,
          width: xSegment.size,
          height: ySegment.size,
        },
        expectedPixelWidth: expectedPixels(xSegment.size, request.pixelScale),
        expectedPixelHeight: expectedPixels(ySegment.size, request.pixelScale),
        overlapTopCss: 0,
        overlapLeftCss: 0,
        status: "planned",
        attempts: 0,
      });
    }
  }

  validateTileCoverage(limitedTargetRect, rows.length, columns.length, tiles);
  return {
    targetRect: limitedTargetRect,
    requestedTargetRect: targetRect,
    rowCount: rows.length,
    columnCount: columns.length,
    tiles,
    limitedByMaxTiles,
  };
}

export function validateTileCoverage(
  targetRect: Rect,
  rowCount: number,
  columnCount: number,
  tiles: CaptureTile[],
): void {
  if (tiles.length !== rowCount * columnCount || rowCount <= 0 || columnCount <= 0) {
    throw planError("The tile grid dimensions do not match the tile list.", "InvalidGrid");
  }

  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const index = row * columnCount + column;
      const tile = tiles[index];
      if (
        tile === undefined ||
        tile.index !== index ||
        tile.row !== row ||
        tile.column !== column
      ) {
        throw planError("Tile indexes are not deterministic row-major values.", "InvalidTileIndex");
      }

      const expectedX =
        column === 0 ? targetRect.x : right(tiles[index - 1]?.sourceRectCss ?? targetRect);
      const expectedY =
        row === 0
          ? targetRect.y
          : bottom(tiles[(row - 1) * columnCount + column]?.sourceRectCss ?? targetRect);

      if (
        Math.abs(tile.sourceRectCss.x - expectedX) > TILE_COVERAGE_EPSILON_CSS ||
        Math.abs(tile.sourceRectCss.y - expectedY) > TILE_COVERAGE_EPSILON_CSS ||
        tile.sourceRectCss.width <= 0 ||
        tile.sourceRectCss.height <= 0
      ) {
        throw planError("The tile plan contains a gap, overlap, or empty tile.", "InvalidCoverage");
      }
    }
  }

  const lastTile = tiles.at(-1);
  if (
    lastTile === undefined ||
    Math.abs(right(lastTile.sourceRectCss) - right(targetRect)) > TILE_COVERAGE_EPSILON_CSS ||
    Math.abs(bottom(lastTile.sourceRectCss) - bottom(targetRect)) > TILE_COVERAGE_EPSILON_CSS
  ) {
    throw planError(
      "The tile grid does not cover the full target rectangle.",
      "IncompleteCoverage",
    );
  }
}

export function splitRectForPixelArea(
  rect: Rect,
  pixelScale: number,
  maxPixelArea: number,
): Rect[] {
  if (
    !isFiniteRect(rect) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isFinite(pixelScale) ||
    pixelScale <= 0 ||
    !Number.isInteger(maxPixelArea) ||
    maxPixelArea <= 0
  ) {
    throw planError("Dynamic tile splitting requires positive finite inputs.", "InvalidSplitInput");
  }

  const pending = [rect];
  const result: Rect[] = [];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) {
      break;
    }

    const area =
      expectedPixels(current.width, pixelScale) * expectedPixels(current.height, pixelScale);
    if (area <= maxPixelArea) {
      result.push(current);
      continue;
    }

    const splitHorizontally =
      expectedPixels(current.width, pixelScale) >= expectedPixels(current.height, pixelScale);
    if (splitHorizontally) {
      const firstWidth = current.width / 2;
      pending.push(
        { ...current, width: firstWidth },
        {
          x: current.x + firstWidth,
          y: current.y,
          width: current.width - firstWidth,
          height: current.height,
        },
      );
    } else {
      const firstHeight = current.height / 2;
      pending.push(
        { ...current, height: firstHeight },
        {
          x: current.x,
          y: current.y + firstHeight,
          width: current.width,
          height: current.height - firstHeight,
        },
      );
    }

    if (pending.length + result.length > 4_096) {
      throw planError("Dynamic splitting exceeded the safety limit.", "SplitLimitExceeded");
    }
  }

  return result;
}
