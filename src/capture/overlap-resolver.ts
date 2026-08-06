import { TILE_COVERAGE_EPSILON_CSS } from "@shared/constants";
import type { CaptureTile, Rect } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

export interface ScrollCapturePlanRequest {
  jobId: string;
  targetRect: Rect;
  viewportWidthCss: number;
  viewportHeightCss: number;
  pixelScale: number;
  overlapCss: number;
  maxTiles: number;
}

export interface ScrollCapturePlan {
  targetRect: Rect;
  requestedTargetRect: Rect;
  rows: number;
  columns: number;
  tiles: CaptureTile[];
  limitedByMaxTiles: boolean;
}

interface ScrollStops {
  stops: number[];
  total: number;
}

function planError(
  message: string,
  causeCode: string,
  safeContext?: Record<string, number>,
): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_TILE_PLAN",
      stage: "plan",
      message,
      userMessageKey: "errors.tilePlan",
      retryable: false,
      fallbackAllowed: false,
      causeCode,
      ...(safeContext === undefined ? {} : { safeContext }),
    }),
  );
}

function requirePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw planError(`Scroll capture ${name} must be a positive finite number.`, "InvalidInput");
  }
  return value;
}

function createStops(
  start: number,
  extent: number,
  viewportExtent: number,
  overlap: number,
  maximumStops: number,
): ScrollStops {
  const maximumStart = Math.max(start, start + extent - viewportExtent);
  if (maximumStart - start <= TILE_COVERAGE_EPSILON_CSS) {
    return { stops: [start], total: 1 };
  }

  const safeOverlap = Math.min(Math.max(0, overlap), Math.max(0, viewportExtent - 1));
  const step = Math.max(1, viewportExtent - safeOverlap);
  const distance = maximumStart - start;
  const total = Math.max(
    1,
    Math.ceil((distance - TILE_COVERAGE_EPSILON_CSS) / step) + 1,
  );
  const boundedCount = Math.min(total, Math.max(1, Math.floor(maximumStops)));
  const stops = Array.from({ length: boundedCount }, (_, index) =>
    Math.min(maximumStart, start + index * step),
  );

  return { stops, total };
}

function assertCoverage(target: Rect, tiles: CaptureTile[], rows: number, columns: number): void {
  if (tiles.length !== rows * columns) {
    throw planError("Scroll capture tile count does not match its grid.", "GridSizeMismatch");
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const tile = tiles[index];
      const output = tile?.outputRectCss;
      if (tile === undefined || output === undefined || output.width <= 0 || output.height <= 0) {
        throw planError("Scroll capture produced an empty output tile.", "EmptyOutputTile", {
          index,
        });
      }

      if (column === 0 && Math.abs(output.x - target.x) > TILE_COVERAGE_EPSILON_CSS) {
        throw planError("Scroll capture does not start at the target left edge.", "LeftGap", {
          row,
        });
      }
      if (column > 0) {
        const previous = tiles[index - 1]?.outputRectCss;
        if (
          previous === undefined ||
          Math.abs(previous.x + previous.width - output.x) > TILE_COVERAGE_EPSILON_CSS
        ) {
          throw planError("Scroll capture contains a horizontal coverage gap.", "HorizontalGap", {
            row,
            column,
          });
        }
      }
      if (
        column === columns - 1 &&
        Math.abs(output.x + output.width - (target.x + target.width)) > TILE_COVERAGE_EPSILON_CSS
      ) {
        throw planError("Scroll capture does not reach the target right edge.", "RightGap", {
          row,
        });
      }

      if (row === 0 && Math.abs(output.y - target.y) > TILE_COVERAGE_EPSILON_CSS) {
        throw planError("Scroll capture does not start at the target top edge.", "TopGap", {
          column,
        });
      }
      if (row > 0) {
        const previous = tiles[index - columns]?.outputRectCss;
        if (
          previous === undefined ||
          Math.abs(previous.y + previous.height - output.y) > TILE_COVERAGE_EPSILON_CSS
        ) {
          throw planError("Scroll capture contains a vertical coverage gap.", "VerticalGap", {
            row,
            column,
          });
        }
      }
      if (
        row === rows - 1 &&
        Math.abs(output.y + output.height - (target.y + target.height)) >
          TILE_COVERAGE_EPSILON_CSS
      ) {
        throw planError("Scroll capture does not reach the target bottom edge.", "BottomGap", {
          column,
        });
      }
    }
  }
}

export function planScrollCaptureTiles(request: ScrollCapturePlanRequest): ScrollCapturePlan {
  const target = request.targetRect;
  requirePositive(target.width, "target width");
  requirePositive(target.height, "target height");
  const viewportWidth = requirePositive(request.viewportWidthCss, "viewport width");
  const viewportHeight = requirePositive(request.viewportHeightCss, "viewport height");
  const pixelScale = requirePositive(request.pixelScale, "pixel scale");
  const maxTiles = Math.floor(requirePositive(request.maxTiles, "maximum tile count"));
  const overlap = Number.isFinite(request.overlapCss) ? Math.max(0, request.overlapCss) : 0;

  const xPlan = createStops(target.x, target.width, viewportWidth, overlap, maxTiles);
  const columnCount = xPlan.stops.length;
  const maximumRows = Math.max(1, Math.floor(maxTiles / columnCount));
  const yPlan = createStops(target.y, target.height, viewportHeight, overlap, maximumRows);
  const limitedByMaxTiles = xPlan.total > maxTiles / yPlan.total;
  const xStops = xPlan.stops;
  const yStops = yPlan.stops;
  const limitedTarget: Rect = {
    x: target.x,
    y: target.y,
    width: Math.min(target.width, (xStops.at(-1) ?? target.x) + viewportWidth - target.x),
    height: Math.min(target.height, (yStops.at(-1) ?? target.y) + viewportHeight - target.y),
  };

  const tiles: CaptureTile[] = [];
  for (let row = 0; row < yStops.length; row += 1) {
    const scrollY = yStops[row] as number;
    const previousBottom = row === 0 ? target.y : (yStops[row - 1] as number) + viewportHeight;
    const outputY = Math.max(target.y, previousBottom, scrollY);
    const outputBottom = Math.min(limitedTarget.y + limitedTarget.height, scrollY + viewportHeight);

    for (let column = 0; column < xStops.length; column += 1) {
      const scrollX = xStops[column] as number;
      const previousRight =
        column === 0 ? target.x : (xStops[column - 1] as number) + viewportWidth;
      const outputX = Math.max(target.x, previousRight, scrollX);
      const outputRight = Math.min(limitedTarget.x + limitedTarget.width, scrollX + viewportWidth);
      const index = row * xStops.length + column;
      const sourceRectCss: Rect = {
        x: scrollX,
        y: scrollY,
        width: viewportWidth,
        height: viewportHeight,
      };
      const outputRectCss: Rect = {
        x: outputX,
        y: outputY,
        width: outputRight - outputX,
        height: outputBottom - outputY,
      };

      tiles.push({
        id: `${request.jobId}:${index}`,
        jobId: request.jobId,
        index,
        row,
        column,
        sourceRectCss,
        outputRectCss,
        scrollXCss: scrollX,
        scrollYCss: scrollY,
        expectedPixelWidth: Math.max(1, Math.round(viewportWidth * pixelScale)),
        expectedPixelHeight: Math.max(1, Math.round(viewportHeight * pixelScale)),
        overlapTopCss: Math.max(0, outputY - scrollY),
        overlapLeftCss: Math.max(0, outputX - scrollX),
        overlapRightCss: Math.max(0, scrollX + viewportWidth - outputRight),
        overlapBottomCss: Math.max(0, scrollY + viewportHeight - outputBottom),
        status: "planned",
        attempts: 0,
      });
    }
  }

  assertCoverage(limitedTarget, tiles, yStops.length, xStops.length);
  return {
    targetRect: limitedTarget,
    requestedTargetRect: target,
    rows: yStops.length,
    columns: xStops.length,
    tiles,
    limitedByMaxTiles,
  };
}
