import { describe, expect, it } from "vitest";

import {
  ADAPTIVE_STABLE_BOTTOM_ROUNDS,
  observeStableEnd,
} from "@capture/stable-end-detector";
import type { AdaptiveCaptureFrontier } from "@shared/contracts/domain";

function frontier(patch: Partial<AdaptiveCaptureFrontier> = {}): AdaptiveCaptureFrontier {
  return {
    schemaVersion: 1,
    nextYCss: 900,
    capturedBottomCss: 900,
    observedDocumentHeightCss: 1_000,
    stableBottomRounds: 0,
    capturedRows: 9,
    storedBytes: 10_000,
    startedAt: "2026-08-05T00:00:00.000Z",
    lastGrowthAt: "2026-08-05T00:00:00.000Z",
    sourceDocumentToken: "document-1",
    documentWidthCss: 100,
    viewportWidthCss: 100,
    viewportHeightCss: 100,
    devicePixelRatio: 1,
    ...patch,
  };
}

describe("observeStableEnd", () => {
  it("requires three stable bottom rounds plus a final probe", () => {
    let current = frontier();
    const completions: boolean[] = [];
    for (let index = 0; index <= ADAPTIVE_STABLE_BOTTOM_ROUNDS; index += 1) {
      const result = observeStableEnd(current, {
        actualScrollY: 900,
        viewportHeight: 100,
        documentHeight: 1_000,
        stableSamples: 1,
        mutationCount: index,
        observedAt: `2026-08-05T00:00:0${index}.000Z`,
      });
      current = result.frontier;
      completions.push(result.complete);
    }

    expect(completions).toEqual([false, false, false, true]);
    expect(current.stableBottomRounds).toBe(4);
  });

  it("resets stable rounds and records finite lazy growth", () => {
    const result = observeStableEnd(
      frontier({ stableBottomRounds: 3 }),
      {
        actualScrollY: 900,
        viewportHeight: 100,
        documentHeight: 1_240,
        stableSamples: 1,
        mutationCount: 4,
        observedAt: "2026-08-05T00:00:10.000Z",
      },
    );

    expect(result.grew).toBe(true);
    expect(result.atBottom).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.frontier.observedDocumentHeightCss).toBe(1_240);
    expect(result.frontier.stableBottomRounds).toBe(0);
    expect(result.frontier.lastGrowthAt).toBe("2026-08-05T00:00:10.000Z");
  });

  it("does not count an unsettled bottom observation", () => {
    const result = observeStableEnd(frontier({ stableBottomRounds: 2 }), {
      actualScrollY: 900,
      viewportHeight: 100,
      documentHeight: 1_000,
      stableSamples: 0,
      mutationCount: 10,
      observedAt: "2026-08-05T00:00:10.000Z",
    });

    expect(result.atBottom).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.frontier.stableBottomRounds).toBe(0);
  });
});
