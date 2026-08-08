import { describe, expect, it } from "vitest";

import { planPdfPageCaptureTiles } from "@capture/pdf-page-capture-planner";

function covered(rect: { x: number; y: number; width: number; height: number }, tiles: ReturnType<typeof planPdfPageCaptureTiles>["tiles"]): boolean {
  const epsilon = 0.01;
  const points = [
    [rect.x + epsilon, rect.y + epsilon],
    [rect.x + rect.width - epsilon, rect.y + epsilon],
    [rect.x + epsilon, rect.y + rect.height - epsilon],
    [rect.x + rect.width - epsilon, rect.y + rect.height - epsilon],
  ];
  return points.every(([x, y]) =>
    tiles.some((tile) => {
      const output = tile.outputRectCss;
      return (
        output !== undefined &&
        x !== undefined &&
        y !== undefined &&
        x >= output.x - epsilon &&
        x <= output.x + output.width + epsilon &&
        y >= output.y - epsilon &&
        y <= output.y + output.height + epsilon
      );
    }),
  );
}

describe("planPdfPageCaptureTiles", () => {
  it("captures an inset page without requesting an impossible page-left scroll", () => {
    const pageRect = { x: 90, y: 40, width: 640, height: 500 };
    const plan = planPdfPageCaptureTiles({
      jobId: "job-pdf",
      pageIndex: 0,
      pageRect,
      documentWidth: 820,
      documentHeight: 700,
      viewportWidth: 800,
      viewportHeight: 600,
      pixelScale: 1,
      overlapCss: 64,
      startTileIndex: 0,
      maxTilesPerPage: 4_096,
    });

    expect(plan.tileCount).toBe(1);
    expect(plan.tiles[0]).toMatchObject({
      index: 0,
      scrollXCss: 20,
      scrollYCss: 40,
      outputRectCss: pageRect,
    });
    expect(covered(pageRect, plan.tiles)).toBe(true);
  });

  it("tiles only inside one giant logical page and keeps global indexes monotonic", () => {
    const pageRect = { x: 120, y: 300, width: 1_900, height: 1_500 };
    const plan = planPdfPageCaptureTiles({
      jobId: "job-pdf",
      pageIndex: 7,
      pageRect,
      documentWidth: 2_200,
      documentHeight: 2_100,
      viewportWidth: 800,
      viewportHeight: 600,
      pixelScale: 2,
      overlapCss: 64,
      startTileIndex: 41,
      maxTilesPerPage: 4_096,
    });

    expect(plan.rows).toBeGreaterThan(1);
    expect(plan.columns).toBeGreaterThan(1);
    expect(plan.tiles[0]?.index).toBe(41);
    expect(plan.tiles.at(-1)?.index).toBe(41 + plan.tileCount - 1);
    expect(plan.tiles.every((tile) => tile.outputRectCss !== undefined)).toBe(true);
    expect(covered(pageRect, plan.tiles)).toBe(true);
  });

  it("fails one unsafe page instead of truncating it at a page-internal tile limit", () => {
    expect(() =>
      planPdfPageCaptureTiles({
        jobId: "job-pdf",
        pageIndex: 0,
        pageRect: { x: 0, y: 0, width: 10_000, height: 10_000 },
        documentWidth: 10_000,
        documentHeight: 10_000,
        viewportWidth: 500,
        viewportHeight: 500,
        pixelScale: 1,
        overlapCss: 64,
        startTileIndex: 0,
        maxTilesPerPage: 10,
      }),
    ).toThrowError(expect.objectContaining({ data: expect.objectContaining({ causeCode: "PdfPageTileBudgetExceeded" }) }));
  });
});
