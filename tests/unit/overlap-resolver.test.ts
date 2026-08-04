import { describe, expect, it } from "vitest";

import { planScrollCaptureTiles } from "@capture/overlap-resolver";

function plan(height: number, width = 900) {
  return planScrollCaptureTiles({
    jobId: "job-scroll",
    targetRect: { x: 0, y: 0, width, height },
    viewportWidthCss: 900,
    viewportHeightCss: 600,
    pixelScale: 2,
    overlapCss: 64,
    maxTiles: 256,
  });
}

describe("planScrollCaptureTiles", () => {
  it("plans a short page as one viewport tile with edge crop metadata", () => {
    const result = plan(400);

    expect(result.rows).toBe(1);
    expect(result.columns).toBe(1);
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0]).toMatchObject({
      sourceRectCss: { x: 0, y: 0, width: 900, height: 600 },
      outputRectCss: { x: 0, y: 0, width: 900, height: 400 },
      overlapTopCss: 0,
      overlapLeftCss: 0,
      overlapBottomCss: 200,
      expectedPixelWidth: 1800,
      expectedPixelHeight: 1200,
    });
  });

  it("creates deterministic vertical stops with no logical gap", () => {
    const result = plan(1_500);
    const outputs = result.tiles.map((tile) => tile.outputRectCss);

    expect(result.rows).toBe(3);
    expect(result.columns).toBe(1);
    expect(result.tiles.map((tile) => tile.scrollYCss)).toEqual([0, 536, 900]);
    expect(outputs).toEqual([
      { x: 0, y: 0, width: 900, height: 600 },
      { x: 0, y: 600, width: 900, height: 536 },
      { x: 0, y: 1_136, width: 900, height: 364 },
    ]);
    expect(result.tiles.map((tile) => tile.overlapTopCss)).toEqual([0, 64, 236]);
  });

  it("plans two-dimensional capture for a wide table", () => {
    const result = planScrollCaptureTiles({
      jobId: "wide",
      targetRect: { x: 20, y: 40, width: 1_700, height: 1_000 },
      viewportWidthCss: 900,
      viewportHeightCss: 600,
      pixelScale: 1.25,
      overlapCss: 64,
      maxTiles: 10,
    });

    expect(result.rows).toBe(2);
    expect(result.columns).toBe(2);
    expect(result.tiles.map((tile) => tile.index)).toEqual([0, 1, 2, 3]);
    expect(result.tiles.map((tile) => [tile.row, tile.column])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    expect(result.tiles.at(-1)?.outputRectCss).toEqual({
      x: 920,
      y: 640,
      width: 800,
      height: 400,
    });
  });

  it("returns an explicit contiguous partial fallback plan above maxTiles", () => {
    const result = planScrollCaptureTiles({
      jobId: "limited",
      targetRect: { x: 0, y: 0, width: 3_000, height: 3_000 },
      viewportWidthCss: 500,
      viewportHeightCss: 500,
      pixelScale: 1,
      overlapCss: 64,
      maxTiles: 4,
    });

    expect(result.limitedByMaxTiles).toBe(true);
    expect(result.tiles).toHaveLength(4);
    expect(result.rows).toBe(1);
    expect(result.columns).toBe(4);
    expect(result.targetRect).toEqual({ x: 0, y: 0, width: 1_808, height: 500 });
  });
});
