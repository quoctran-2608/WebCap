import { describe, expect, it } from "vitest";

import { clamp } from "@shared/clamp";

describe("clamp", () => {
  it("returns a value that is already inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("uses the minimum when the value is below the range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });

  it("uses the maximum when the value is above the range", () => {
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("supports a zero-width inclusive range", () => {
    expect(clamp(100, 4, 4)).toBe(4);
  });

  it("rejects an inverted range", () => {
    expect(() => clamp(5, 10, 0)).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects a non-finite value: %s",
    (value) => {
      expect(() => clamp(value, 0, 10)).toThrow(TypeError);
    },
  );
});
