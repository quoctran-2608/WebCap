import {
  clampRectToBounds,
  planCaptureTiles,
  splitRectForPixelArea,
  validateTileCoverage,
} from "@capture/tile-planner";
import { TILE_MAX_PIXEL_AREA } from "@shared/constants";
import { WebCapRuntimeError } from "@shared/errors/error";

const documentBounds = { x: 0, y: 0, width: 20_000, height: 120_000 };

function plan(
  targetRect = documentBounds,
  options: {
    pixelScale?: number;
    maxTiles?: number;
    maxTileWidthCss?: number;
    maxTileHeightCss?: number;
    maxTilePixelArea?: number;
  } = {},
) {
  return planCaptureTiles({
    jobId: "job-1",
    documentBounds,
    targetRect,
    pixelScale: options.pixelScale ?? 1,
    limits: {
      maxTiles: options.maxTiles ?? 256,
      ...(options.maxTileWidthCss === undefined
        ? {}
        : { maxTileWidthCss: options.maxTileWidthCss }),
      ...(options.maxTileHeightCss === undefined
        ? {}
        : { maxTileHeightCss: options.maxTileHeightCss }),
      ...(options.maxTilePixelArea === undefined
        ? {}
        : { maxTilePixelArea: options.maxTilePixelArea }),
    },
  });
}

describe("tile planner", () => {
  it("creates one short-page tile", () => {
    const result = plan({ x: 0, y: 0, width: 800, height: 600 });
    expect(result.rowCount).toBe(1);
    expect(result.columnCount).toBe(1);
    expect(result.tiles[0]?.sourceRectCss).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("uses deterministic row-major indexes for an exact 2D multiple", () => {
    const result = plan(
      { x: 0, y: 0, width: 2000, height: 3000 },
      { maxTileWidthCss: 1000, maxTileHeightCss: 1000 },
    );

    expect(result.columnCount).toBe(2);
    expect(result.rowCount).toBe(3);
    expect(result.tiles.map((tile) => [tile.index, tile.row, tile.column])).toEqual([
      [0, 0, 0],
      [1, 0, 1],
      [2, 1, 0],
      [3, 1, 1],
      [4, 2, 0],
      [5, 2, 1],
    ]);
  });

  it("keeps the final row and column at their remainder size", () => {
    const result = plan(
      { x: 0, y: 0, width: 2100, height: 2500 },
      { maxTileWidthCss: 1000, maxTileHeightCss: 1000 },
    );

    expect(result.tiles[2]?.sourceRectCss.width).toBe(100);
    expect(result.tiles.at(-1)?.sourceRectCss).toEqual({
      x: 2000,
      y: 2000,
      width: 100,
      height: 500,
    });
  });

  it("clamps negative and out-of-bounds targets to the document", () => {
    expect(
      clampRectToBounds(
        { x: -50, y: -20, width: 500, height: 300 },
        { x: 0, y: 0, width: 400, height: 200 },
      ),
    ).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });

  it("rejects targets that do not intersect the document", () => {
    expect(() => plan({ x: 30_000, y: 0, width: 10, height: 10 })).toThrowError(
      WebCapRuntimeError,
    );
  });

  it.each([10_000, 30_000, 100_000])("covers a %i CSS-pixel tall page", (height) => {
    const result = plan({ x: 0, y: 0, width: 1200, height });
    validateTileCoverage(result.targetRect, result.rowCount, result.columnCount, result.tiles);
    expect(result.tiles.at(-1)?.sourceRectCss.y).toBeLessThan(height);
    expect(
      (result.tiles.at(-1)?.sourceRectCss.y ?? 0) +
        (result.tiles.at(-1)?.sourceRectCss.height ?? 0),
    ).toBeCloseTo(height, 8);
  });

  it("splits both axes for a wide page", () => {
    const result = plan({ x: 0, y: 0, width: 18_000, height: 20_000 });
    expect(result.columnCount).toBe(3);
    expect(result.rowCount).toBe(3);
    expect(result.tiles).toHaveLength(9);
  });

  it("preserves fractional CSS coordinates without coverage gaps", () => {
    const result = plan(
      { x: 0.25, y: 10.5, width: 2000.75, height: 3000.125 },
      { maxTileWidthCss: 777.7, maxTileHeightCss: 999.9, pixelScale: 1.25 },
    );

    validateTileCoverage(result.targetRect, result.rowCount, result.columnCount, result.tiles);
    expect(result.tiles[0]?.sourceRectCss.x).toBe(0.25);
    expect(result.tiles.at(-1)?.sourceRectCss.y).toBeGreaterThan(10.5);
  });

  it("reduces tile height when device-scale pixel area exceeds the guardrail", () => {
    const result = plan(
      { x: 0, y: 0, width: 8192, height: 8192 },
      { pixelScale: 2, maxTilePixelArea: TILE_MAX_PIXEL_AREA },
    );

    expect(result.rowCount).toBeGreaterThan(1);
    for (const tile of result.tiles) {
      expect(tile.expectedPixelWidth * tile.expectedPixelHeight).toBeLessThanOrEqual(
        TILE_MAX_PIXEL_AREA,
      );
    }
  });

  it("rejects a plan beyond maxTiles", () => {
    expect(() =>
      plan(
        { x: 0, y: 0, width: 10_000, height: 10_000 },
        { maxTileWidthCss: 100, maxTileHeightCss: 100, maxTiles: 10 },
      ),
    ).toThrowError(WebCapRuntimeError);
  });

  it("dynamically bisects an oversized rectangle until every piece is safe", () => {
    const pieces = splitRectForPixelArea(
      { x: 0, y: 0, width: 8000, height: 8000 },
      2,
      16_000_000,
    );

    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      const pixelWidth = Math.ceil(piece.width * 2 - 0.01);
      const pixelHeight = Math.ceil(piece.height * 2 - 0.01);
      expect(pixelWidth * pixelHeight).toBeLessThanOrEqual(16_000_000);
    }
    expect(pieces.reduce((area, piece) => area + piece.width * piece.height, 0)).toBeCloseTo(
      64_000_000,
      6,
    );
  });
});
