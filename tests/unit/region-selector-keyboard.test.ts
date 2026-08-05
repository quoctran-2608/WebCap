import { describe, expect, it } from "vitest";

import { createCenteredKeyboardRect, resizeRectWithKeyboard } from "@content/region-selector";

describe("region selector keyboard geometry", () => {
  it("creates a centered rectangle bounded by the visible document area", () => {
    expect(
      createCenteredKeyboardRect(
        { x: 0, y: 0, width: 2_000, height: 3_000 },
        { x: 200, y: 400, width: 800, height: 600 },
      ),
    ).toEqual({ x: 400, y: 580, width: 400, height: 240 });
  });

  it("resizes the east and south edges with one and ten pixel steps", () => {
    const bounds = { x: 0, y: 0, width: 1_000, height: 1_000 };
    const initial = { x: 100, y: 120, width: 300, height: 220 };
    expect(resizeRectWithKeyboard(initial, "ArrowRight", 1, bounds)).toEqual({
      ...initial,
      width: 301,
    });
    expect(resizeRectWithKeyboard(initial, "ArrowUp", 10, bounds)).toEqual({
      ...initial,
      height: 210,
    });
  });

  it("never shrinks below the minimum or grows beyond document bounds", () => {
    const bounds = { x: 0, y: 0, width: 500, height: 500 };
    expect(
      resizeRectWithKeyboard(
        { x: 490, y: 490, width: 10, height: 10 },
        "ArrowRight",
        20,
        bounds,
        2,
      ),
    ).toEqual({ x: 490, y: 490, width: 10, height: 10 });
    expect(
      resizeRectWithKeyboard({ x: 20, y: 20, width: 2, height: 2 }, "ArrowLeft", 10, bounds, 2),
    ).toEqual({ x: 20, y: 20, width: 2, height: 2 });
  });
});
