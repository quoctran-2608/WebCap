import { describe, expect, it } from "vitest";

import {
  isPagePreparationRequest,
  layoutSamplesMatch,
  nextLazyScrollPosition,
  shouldRestoreCssProperty,
  updateStableSampleCount,
  type LayoutSample,
} from "@content/entry";

const sample: LayoutSample = {
  width: 1200,
  height: 8000,
  mutationRevision: 4,
  pendingImages: 0,
};

describe("page preparation content helpers", () => {
  it("requires dimensions, mutation revision, and pending images to remain stable", () => {
    expect(layoutSamplesMatch(sample, { ...sample })).toBe(true);
    expect(layoutSamplesMatch(sample, { ...sample, height: 8001 })).toBe(false);
    expect(layoutSamplesMatch(sample, { ...sample, mutationRevision: 5 })).toBe(false);
    expect(updateStableSampleCount(sample, { ...sample }, 1)).toBe(2);
    expect(updateStableSampleCount(sample, { ...sample, pendingImages: 1 }, 3)).toBe(0);
  });

  it("restores a property only while the WebCap-applied value still owns it", () => {
    expect(shouldRestoreCssProperty("hidden", "important", "hidden", "important")).toBe(true);
    expect(shouldRestoreCssProperty("visible", "", "hidden", "important")).toBe(false);
    expect(shouldRestoreCssProperty("hidden", "", "hidden", "important")).toBe(false);
  });

  it("advances lazy pre-scroll with clamped deterministic steps", () => {
    expect(nextLazyScrollPosition(0, 1000, 0.8, 5000)).toBe(800);
    expect(nextLazyScrollPosition(4700, 1000, 0.8, 5000)).toBe(5000);
    expect(nextLazyScrollPosition(Number.NaN, 0, 5, -20)).toBe(0);
  });

  it("accepts only the versioned background-to-content request shape", () => {
    expect(
      isPagePreparationRequest({
        protocolVersion: 1,
        requestId: "request-1",
        source: "background",
        target: "content",
        type: "PAGE_PREPARATION_PREPARE",
        payload: {
          preparationId: "job-1",
          options: {
            targetStartX: 0,
            targetStartY: 0,
            maxCssHeight: 100_000,
            lazyLoad: {
              enabled: true,
              stepRatio: 0.8,
              settleMs: 250,
              maxDurationMs: 15_000,
            },
          },
        },
        sentAt: "2026-08-03T02:00:00.000Z",
      }),
    ).toBe(true);

    expect(
      isPagePreparationRequest({
        protocolVersion: 2,
        requestId: "request-1",
        source: "background",
        target: "content",
        type: "PAGE_PREPARATION_RESTORE",
        payload: { preparationId: "job-1" },
        sentAt: "2026-08-03T02:00:00.000Z",
      }),
    ).toBe(false);
  });
});
