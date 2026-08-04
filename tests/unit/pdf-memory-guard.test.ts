import { describe, expect, it } from "vitest";

import { assertPdfExportMemorySafe, estimatePdfExportMemory } from "@offscreen/pdf-memory-guard";
import { WebCapRuntimeError } from "@shared/errors/error";

describe("PDF memory guard", () => {
  it("accepts a 100k CSS-pixel page when the page-at-a-time working set stays bounded", () => {
    const estimate = assertPdfExportMemorySafe({
      widthCss: 1_440,
      heightCss: 100_000,
      renderScaleX: 1,
      renderScaleY: 1,
      tileCount: 13,
      tileBytes: 96 * 1_024 * 1_024,
      pageCount: 58,
      maxPagePixelArea: 1_440 * 2_100,
      largestTilePixelArea: 1_440 * 8_192,
      jpegQuality: 0.82,
      heapLimitBytes: 512 * 1_024 * 1_024,
    });

    expect(estimate.shouldBlock).toBe(false);
    expect(estimate.totalPixels).toBe(144_000_000);
    expect(estimate.estimatedWorkingSetBytes).toBeLessThan(estimate.thresholdBytes);
    expect(estimate.alternatives).toEqual(["lower-quality", "split-output", "multi-page-pdf"]);
  });

  it("blocks a single-page working set that exceeds the safe heap budget", () => {
    const input = {
      widthCss: 20_000,
      heightCss: 80_000,
      renderScaleX: 1,
      renderScaleY: 1,
      tileCount: 10,
      tileBytes: 240 * 1_024 * 1_024,
      pageCount: 40,
      maxPagePixelArea: 20_000 * 2_000,
      largestTilePixelArea: 20_000 * 8_192,
      jpegQuality: 0.9,
      heapLimitBytes: 512 * 1_024 * 1_024,
    };

    const estimate = estimatePdfExportMemory(input);
    expect(estimate.shouldBlock).toBe(true);
    expect(estimate.reasons).toContain("working-set");

    try {
      assertPdfExportMemorySafe(input);
      throw new Error("Expected the PDF memory guard to reject the export.");
    } catch (error) {
      expect(error).toBeInstanceOf(WebCapRuntimeError);
      expect(error).toMatchObject({
        name: "E_MEMORY_GUARD",
        code: "E_MEMORY_GUARD",
        stage: "export",
        retryable: true,
        fallbackAllowed: true,
      });
      if (error instanceof WebCapRuntimeError) {
        expect(error.data.causeCode).toBe("PdfWorkingSetEstimateExceeded");
        const reasons = error.data.safeContext?.reasons;
        const alternatives = error.data.safeContext?.alternatives;
        expect(typeof reasons).toBe("string");
        expect(typeof alternatives).toBe("string");
        if (typeof reasons === "string") expect(reasons).toContain("working-set");
        if (typeof alternatives === "string") {
          expect(alternatives).toBe("lower-quality,split-output,multi-page-pdf");
        }
      }
    }
  });

  it("reports independent guard reasons for excessive tile metadata", () => {
    const estimate = estimatePdfExportMemory({
      widthCss: 1_440,
      heightCss: 100_000,
      renderScaleX: 1,
      renderScaleY: 1,
      tileCount: 4_097,
      tileBytes: 1_501 * 1_024 * 1_024,
      pageCount: 58,
      maxPagePixelArea: 1_440 * 2_100,
      largestTilePixelArea: 1_440 * 8_192,
      jpegQuality: 0.75,
    });

    expect(estimate.reasons).toEqual(expect.arrayContaining(["tile-count", "tile-bytes"]));
  });
});
