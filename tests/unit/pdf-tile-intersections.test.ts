import { describe, expect, it } from "vitest";

import { planPdfTileIntersections, resolveTileOutputRect } from "@offscreen/pdf-tile-intersections";
import type { CaptureTile } from "@shared/contracts/domain";

function tile(index: number, sourceY: number, outputY: number, outputHeight: number): CaptureTile {
  return {
    id: `job-1:${index}`,
    jobId: "job-1",
    index,
    row: index,
    column: 0,
    sourceRectCss: { x: 0, y: sourceY, width: 400, height: 300 },
    outputRectCss: { x: 0, y: outputY, width: 400, height: outputHeight },
    expectedPixelWidth: 800,
    expectedPixelHeight: 600,
    overlapTopCss: outputY - sourceY,
    overlapLeftCss: 0,
    overlapRightCss: 0,
    overlapBottomCss: sourceY + 300 - (outputY + outputHeight),
    status: "stored",
    attempts: 1,
    byteLength: 3,
    mimeType: "image/png",
  };
}

describe("PDF tile intersection planner", () => {
  it("partitions a page crossing an overlapped scroll-tile boundary", () => {
    const tiles = [tile(0, 0, 0, 250), tile(1, 200, 250, 250)];
    const intersections = planPdfTileIntersections(
      { x: 0, y: 180, width: 400, height: 180 },
      tiles,
    );

    expect(intersections).toHaveLength(2);
    expect(intersections[0]).toMatchObject({
      tileIndex: 0,
      logicalRectCss: { x: 0, y: 180, width: 400, height: 70 },
      sourceCropCss: { x: 0, y: 180, width: 400, height: 70 },
      pageDestinationCss: { x: 0, y: 0, width: 400, height: 70 },
    });
    expect(intersections[1]).toMatchObject({
      tileIndex: 1,
      logicalRectCss: { x: 0, y: 250, width: 400, height: 110 },
      sourceCropCss: { x: 0, y: 50, width: 400, height: 110 },
      pageDestinationCss: { x: 0, y: 70, width: 400, height: 110 },
    });
  });

  it("derives an output rectangle from overlap metadata for CDP-compatible tiles", () => {
    const current = tile(0, 100, 120, 240);
    delete current.outputRectCss;
    current.overlapTopCss = 20;
    current.overlapLeftCss = 10;
    current.overlapRightCss = 15;
    current.overlapBottomCss = 40;

    expect(resolveTileOutputRect(current)).toEqual({
      x: 10,
      y: 120,
      width: 375,
      height: 240,
    });
  });

  it("offsets source crops into a full-viewport screenshot for scroll areas", () => {
    const current = tile(0, 0, 0, 200);
    current.sourceRectCss = { x: 0, y: 0, width: 300, height: 200 };
    current.outputRectCss = { x: 0, y: 0, width: 300, height: 200 };
    current.captureViewportCss = { x: 0, y: 0, width: 1200, height: 800 };
    current.captureCropCss = { x: 150, y: 90, width: 300, height: 200 };

    expect(planPdfTileIntersections({ x: 20, y: 30, width: 100, height: 80 }, [current])).toEqual([
      expect.objectContaining({
        sourceCropCss: { x: 170, y: 120, width: 100, height: 80 },
      }),
    ]);
  });

  it("rejects a coverage gap instead of producing a white seam", () => {
    const tiles = [tile(0, 0, 0, 200), tile(1, 250, 250, 250)];
    expect(() =>
      planPdfTileIntersections({ x: 0, y: 100, width: 400, height: 300 }, tiles),
    ).toThrow(/cover the complete page/u);
  });

  it("rejects overlapping logical output instead of duplicating content", () => {
    const tiles = [tile(0, 0, 0, 260), tile(1, 200, 240, 260)];
    expect(() =>
      planPdfTileIntersections({ x: 0, y: 200, width: 400, height: 100 }, tiles),
    ).toThrow();
  });
});
