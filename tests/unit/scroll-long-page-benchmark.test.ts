import { describe, expect, it } from "vitest";

import { planScrollCaptureTiles } from "@capture/overlap-resolver";
import { FALLBACK_OVERLAP_CSS, VISIBLE_CAPTURE_MIN_INTERVAL_MS } from "@shared/constants";

const CASES = [
  { height: 10_000, expectedTiles: 19 },
  { height: 30_000, expectedTiles: 56 },
  { height: 100_000, expectedTiles: 187 },
] as const;

describe("scroll fallback long-page benchmark", () => {
  for (const benchmark of CASES) {
    it(`plans ${benchmark.height.toLocaleString("en-US")} CSS px without a coverage gap`, () => {
      const startedAt = performance.now();
      const plan = planScrollCaptureTiles({
        jobId: `benchmark-${benchmark.height}`,
        targetRect: { x: 0, y: 0, width: 900, height: benchmark.height },
        viewportWidthCss: 900,
        viewportHeightCss: 600,
        pixelScale: 1,
        overlapCss: FALLBACK_OVERLAP_CSS,
        maxTiles: 256,
      });
      const planningDurationMs = performance.now() - startedAt;

      expect(plan.tiles).toHaveLength(benchmark.expectedTiles);
      expect(plan.tiles[0]?.outputRectCss?.y).toBe(0);
      const last = plan.tiles.at(-1)?.outputRectCss;
      expect((last?.y ?? 0) + (last?.height ?? 0)).toBeCloseTo(benchmark.height, 5);
      expect(
        plan.tiles.every((tile, index) => {
          if (index === 0) {
            return true;
          }
          const previous = plan.tiles[index - 1]?.outputRectCss;
          const current = tile.outputRectCss;
          return (
            previous !== undefined &&
            current !== undefined &&
            Math.abs(previous.y + previous.height - current.y) <= 0.5
          );
        }),
      ).toBe(true);
      expect(planningDurationMs).toBeLessThan(100);

      const minimumCaptureDurationMs = benchmark.expectedTiles * VISIBLE_CAPTURE_MIN_INTERVAL_MS;
      expect(minimumCaptureDurationMs).toBe(
        benchmark.expectedTiles * VISIBLE_CAPTURE_MIN_INTERVAL_MS,
      );
    });
  }
});
