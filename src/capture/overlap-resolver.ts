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
  rows: number;
  columns: number;
  tiles: CaptureTile[];
}

function planError(message: string, causeCode: string, safeContext?: Record<string, number>): Error {
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
        Math.abs(output.x + output.width - (target.x + target.width)) >
          TILE_COVERAGE_EPSILON_CSS
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

  const xStops = createStops(target.x, target.width, viewportWidth, overlap);
  const yStops = createStops(target.y, target.height, viewportHeight, overlap);
  const tileCount = xStops.length * yStops.length;
  if (tileCount > maxTiles) {
    throw planError("Scroll capture would exceed the configured tile limit.", "MaxTilesExceeded", {
      tileCount,
      maxTiles,
    });
  }

  const tiles: CaptureTile[] = [];
  for (let row = 0; row < yStops.length; row += 1) {
    const scrollY = yStops[row] as number;
    const previousBottom =
      row === 0 ? target.y : (yStops[row - 1] as number) + viewportHeight;
    const outputY = Math.max(target.y, previousBottom, scrollY);
    const outputBottom = Math.min(target.y + target.height, scrollY + viewportHeight);

    for (let column = 0; column < xStops.length; column += 1) {
      const scrollX = xStops[column] as number;
      const previousRight =
        column === 0 ? target.x : (xStops[column - 1] as number) + viewportWidth;
      const outputX = Math.max(target.x, previousRight, scrollX);
      const outputRight = Math.min(target.x + target.width, scrollX + viewportWidth);
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

  assertCoverage(target, tiles, yStops.length, xStops.length);
  return {
    targetRect: target,
    rows: yStops.length,
    columns: xStops.length,
    tiles,
  };
}
