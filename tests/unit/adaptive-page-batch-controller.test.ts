import { describe, expect, it } from "vitest";

import { AdaptivePageBatchController } from "@capture/adaptive-page-batch-controller";
import type { DocumentPage } from "@shared/contracts/domain";

function pages(count: number): DocumentPage[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    sourceRectCss: {
      x: 100,
      y: index * 820,
      width: 600,
      height: 800,
    },
  }));
}

describe("AdaptivePageBatchController", () => {
  it("advances a synthetic 2,000-page document without a document-wide tile cap", () => {
    const sourcePages = pages(2_000);
    const controller = new AdaptivePageBatchController({
      documentWidth: 800,
      documentHeight: 2_000 * 820,
      viewportWidth: 800,
      viewportHeight: 900,
      pixelScale: 1,
      overlapCss: 64,
      maxTilesPerBatch: 256,
      maxEstimatedBytesPerBatch: 128 * 1024 * 1024,
      initialPagesPerBatch: 10,
      maximumPagesPerBatch: 25,
    });

    let cursor = 0;
    let batches = 0;
    let largestBatch = 0;
    const visited: number[] = [];
    while (cursor < sourcePages.length) {
      const batch = controller.nextBatch(sourcePages, cursor);
      expect(batch).toBeDefined();
      if (batch === undefined) break;
      expect(batch.pageIndexes.length).toBeGreaterThan(0);
      expect(batch.pageIndexes.length).toBeLessThanOrEqual(25);
      expect(batch.endPageIndexExclusive).toBeGreaterThan(cursor);
      visited.push(...batch.pageIndexes);
      largestBatch = Math.max(largestBatch, batch.pageIndexes.length);
      cursor = batch.endPageIndexExclusive;
      batches += 1;
      controller.recordOutcome({ durationMs: 500, storedBytes: 2 * 1024 * 1024 });
    }

    expect(visited).toHaveLength(2_000);
    expect(visited[0]).toBe(0);
    expect(visited.at(-1)).toBe(1_999);
    expect(new Set(visited).size).toBe(2_000);
    expect(batches).toBeGreaterThan(1);
    expect(largestBatch).toBeLessThanOrEqual(25);
  });

  it("shrinks after pressure and grows conservatively after healthy batches", () => {
    const controller = new AdaptivePageBatchController({
      documentWidth: 800,
      documentHeight: 8_200,
      viewportWidth: 800,
      viewportHeight: 900,
      pixelScale: 1,
      overlapCss: 64,
      maxTilesPerBatch: 256,
      maxEstimatedBytesPerBatch: 128 * 1024 * 1024,
      initialPagesPerBatch: 12,
      maximumPagesPerBatch: 25,
    });

    expect(controller.getTargetPages()).toBe(12);
    controller.recordOutcome({ durationMs: 2_000, storedBytes: 4 * 1024 * 1024, pressure: true });
    expect(controller.getTargetPages()).toBe(6);
    controller.recordOutcome({ durationMs: 500, storedBytes: 2 * 1024 * 1024 });
    expect(controller.getTargetPages()).toBe(8);
  });

  it("allows one giant page as its own batch even when its estimate exceeds batch budgets", () => {
    const sourcePages: DocumentPage[] = [
      {
        index: 0,
        sourceRectCss: { x: 0, y: 0, width: 4_000, height: 5_000 },
      },
      {
        index: 1,
        sourceRectCss: { x: 0, y: 5_020, width: 600, height: 800 },
      },
    ];
    const controller = new AdaptivePageBatchController({
      documentWidth: 4_000,
      documentHeight: 6_000,
      viewportWidth: 800,
      viewportHeight: 900,
      pixelScale: 2,
      overlapCss: 64,
      maxTilesPerBatch: 4,
      maxEstimatedBytesPerBatch: 4 * 1024 * 1024,
    });

    const batch = controller.nextBatch(sourcePages, 0);
    expect(batch).toMatchObject({
      startPageIndex: 0,
      endPageIndexExclusive: 1,
      pageIndexes: [0],
    });
  });
});
