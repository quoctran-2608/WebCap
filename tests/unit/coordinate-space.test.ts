import { describe, expect, it } from "vitest";

import {
  CoordinateSpace,
  clampRectToBounds,
  edgeAutoScrollDelta,
  moveRectWithinBounds,
  normalizeRectFromPoints,
  resizeRectFromHandle,
} from "@content/coordinate-space";

describe("CoordinateSpace", () => {
  const space = new CoordinateSpace({
    scrollX: 120,
    scrollY: 340,
    visualViewportOffsetLeft: 7,
    visualViewportOffsetTop: 11,
    visualViewportScale: 1.25,
    devicePixelRatio: 2,
    documentWidth: 2_000,
    documentHeight: 5_000,
  });

  it("converts client, document, and device-pixel coordinates consistently", () => {
    expect(space.clientPointToDocument({ x: 30, y: 50 })).toEqual({ x: 157, y: 401 });
    expect(space.documentPointToClient({ x: 157, y: 401 })).toEqual({ x: 30, y: 50 });
    expect(
      space.clientRectToDocument({ x: 30, y: 50, width: 200, height: 100 }),
    ).toEqual({ x: 157, y: 401, width: 200, height: 100 });
    expect(space.cssRectToDevice({ x: 10, y: 20, width: 30, height: 40 })).toEqual({
      x: 25,
      y: 50,
      width: 75,
      height: 100,
    });
  });

  it("normalizes reversed drags and clamps them to document bounds", () => {
    expect(normalizeRectFromPoints({ x: 500, y: 600 }, { x: 100, y: 200 })).toEqual({
      x: 100,
      y: 200,
      width: 400,
      height: 400,
    });
    expect(space.normalizeDocumentRect({ x: -20, y: 4_900 }, { x: 2_100, y: 5_200 })).toEqual({
      x: 0,
      y: 4_900,
      width: 2_000,
      height: 100,
    });
    expect(
      clampRectToBounds(
        { x: 900, y: 900, width: 300, height: 300 },
        { x: 0, y: 0, width: 1_000, height: 1_000 },
      ),
    ).toEqual({ x: 900, y: 900, width: 100, height: 100 });
  });

  it("moves and resizes selections without leaving bounds", () => {
    const bounds = { x: 0, y: 0, width: 1_000, height: 800 };
    const rect = { x: 100, y: 100, width: 300, height: 200 };
    expect(moveRectWithinBounds(rect, { x: 800, y: 700 }, bounds)).toEqual({
      x: 700,
      y: 600,
      width: 300,
      height: 200,
    });
    expect(resizeRectFromHandle(rect, "se", { x: 950, y: 760 }, bounds)).toEqual({
      x: 100,
      y: 100,
      width: 850,
      height: 660,
    });
    expect(resizeRectFromHandle(rect, "nw", { x: -50, y: -20 }, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  it("accelerates auto-scroll only inside the edge threshold", () => {
    expect(edgeAutoScrollDelta({ x: 450, y: 300 }, { width: 900, height: 600 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(edgeAutoScrollDelta({ x: 0, y: 600 }, { width: 900, height: 600 })).toEqual({
      x: -30,
      y: 30,
    });
    const nearBottom = edgeAutoScrollDelta({ x: 450, y: 580 }, { width: 900, height: 600 });
    expect(nearBottom.x).toBe(0);
    expect(nearBottom.y).toBeGreaterThan(0);
    expect(nearBottom.y).toBeLessThan(30);
  });
});
