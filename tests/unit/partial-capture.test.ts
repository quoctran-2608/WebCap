import { describe, expect, it } from "vitest";

import { contiguousStoredPrefix, rectCoveringTiles } from "@capture/partial-capture";
import type { CaptureTile } from "@shared/contracts/domain";

function tile(index: number, status: CaptureTile["status"] = "stored"): CaptureTile {
  const row = Math.floor(index / 2);
  const column = index % 2;
  return {
    id: `job:${index}`,
    jobId: "job",
    index,
    row,
    column,
    sourceRectCss: { x: column * 100, y: row * 100, width: 100, height: 100 },
    expectedPixelWidth: 100,
    expectedPixelHeight: 100,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    status,
    attempts: status === "stored" ? 1 : 0,
  };
}

describe("partial capture helpers", () => {
  it("keeps only complete rows once a later row is partial", () => {
    const result = contiguousStoredPrefix([tile(0), tile(1), tile(2), tile(3, "planned")]);
    expect(result.map((entry) => entry.index)).toEqual([0, 1]);
    expect(rectCoveringTiles(result)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("keeps a contiguous first-row prefix when no full row exists", () => {
    const result = contiguousStoredPrefix([tile(0), tile(1, "planned")]);
    expect(result.map((entry) => entry.index)).toEqual([0]);
    expect(rectCoveringTiles(result)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});
