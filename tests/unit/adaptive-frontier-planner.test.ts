import { describe, expect, it } from "vitest";

import { planAdaptiveCaptureRow } from "@capture/adaptive-frontier-planner";

describe("planAdaptiveCaptureRow", () => {
  it("appends an overlap-aware row without changing prior output coverage", () => {
    const first = planAdaptiveCaptureRow({
      jobId: "job-adaptive",
      nextTileIndex: 0,
      row: 0,
      nextYCss: 0,
      documentWidthCss: 250,
      documentHeightCss: 500,
      viewportWidthCss: 100,
      viewportHeightCss: 100,
      maxCssWidth: 500,
      overlapCss: 20,
      remainingTiles: 10,
    });
    const second = planAdaptiveCaptureRow({
      jobId: "job-adaptive",
      nextTileIndex: first.tiles.length,
      row: 1,
      nextYCss: first.outputBottomCss,
      documentWidthCss: 250,
      documentHeightCss: 500,
      viewportWidthCss: 100,
      viewportHeightCss: 100,
      maxCssWidth: 500,
      overlapCss: 20,
      remainingTiles: 10,
    });

    expect(first.tiles.map((tile) => tile.scrollXCss)).toEqual([0, 80, 150]);
    expect(first.tiles.map((tile) => tile.outputRectCss)).toEqual([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 100, y: 0, width: 80, height: 100 },
      { x: 180, y: 0, width: 70, height: 100 },
    ]);
    expect(second.sourceYCss).toBe(80);
    expect(second.outputBottomCss).toBe(180);
    expect(second.tiles.every((tile) => tile.outputRectCss?.y === 100)).toBe(true);
    expect(first.tiles).toEqual(first.tiles.map((tile) => ({ ...tile })));
  });

  it("refuses to plan only part of a wide row when the tile budget is too small", () => {
    const plan = planAdaptiveCaptureRow({
      jobId: "job-limited",
      nextTileIndex: 4,
      row: 2,
      nextYCss: 200,
      documentWidthCss: 250,
      documentHeightCss: 500,
      viewportWidthCss: 100,
      viewportHeightCss: 100,
      maxCssWidth: 500,
      overlapCss: 20,
      remainingTiles: 2,
    });

    expect(plan.columns).toBe(3);
    expect(plan.limitedByMaxTiles).toBe(true);
    expect(plan.tiles).toEqual([]);
    expect(plan.outputBottomCss).toBe(200);
  });

  it("crops the final row exactly to the observed bottom", () => {
    const plan = planAdaptiveCaptureRow({
      jobId: "job-final",
      nextTileIndex: 5,
      row: 5,
      nextYCss: 460,
      documentWidthCss: 100,
      documentHeightCss: 500,
      viewportWidthCss: 100,
      viewportHeightCss: 100,
      maxCssWidth: 500,
      overlapCss: 20,
      remainingTiles: 5,
    });

    expect(plan.sourceYCss).toBe(400);
    expect(plan.outputBottomCss).toBe(500);
    expect(plan.tiles[0]?.outputRectCss).toEqual({ x: 0, y: 460, width: 100, height: 40 });
    expect(plan.tiles[0]?.overlapTopCss).toBe(60);
    expect(plan.tiles[0]?.overlapBottomCss).toBe(0);
  });
});
