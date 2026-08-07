import { describe, expect, it } from "vitest";

import {
  createRunningPixelRanges,
  cssPxToPt,
  inchesToPt,
  mmToPt,
  planPdfDocument,
  planPdfDocumentPages,
  resolvePdfPageBox,
} from "@offscreen/pdf-layout";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

describe("PDF page layout", () => {
  it("converts physical and CSS units to PDF points", () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 10);
    expect(inchesToPt(8.5)).toBeCloseTo(612, 10);
    expect(cssPxToPt(96)).toBeCloseTo(72, 10);
  });

  it("resolves A4, Letter, landscape, and fit-width boxes", () => {
    const base = DEFAULT_CAPTURE_SETTINGS.pdf;
    const a4 = resolvePdfPageBox(base, 1200);
    expect(a4.widthPt).toBeCloseTo(595.2756, 3);
    expect(a4.heightPt).toBeCloseTo(841.8898, 3);
    expect(a4.printableWidthPt).toBeLessThan(a4.widthPt);
    expect(a4.printableHeightPt).toBeLessThan(a4.heightPt);

    const letter = resolvePdfPageBox({ ...base, pageSize: "letter" }, 1200);
    expect(letter.widthPt).toBeCloseTo(612, 8);
    expect(letter.heightPt).toBeCloseTo(792, 8);

    const landscape = resolvePdfPageBox({ ...base, orientation: "landscape" }, 1200);
    expect(landscape.widthPt).toBeGreaterThan(landscape.heightPt);

    const fitWidth = resolvePdfPageBox({ ...base, pageSize: "fit-width", marginMm: 0 }, 960);
    expect(fitWidth.printableWidthPt).toBeCloseTo(720, 8);
  });

  it("slices a long source continuously without a floating-point seam", () => {
    const source = { x: 25.5, y: 40.25, width: 1080.5, height: 12_345.75 };
    const plan = planPdfDocument(source, DEFAULT_CAPTURE_SETTINGS.pdf);

    expect(plan.pages.length).toBeGreaterThan(2);
    expect(plan.pages[0]?.sourceRectCss.y).toBe(source.y);
    for (let index = 1; index < plan.pages.length; index += 1) {
      const previous = plan.pages[index - 1]?.sourceRectCss;
      const current = plan.pages[index]?.sourceRectCss;
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      expect(current?.y).toBeCloseTo((previous?.y ?? 0) + (previous?.height ?? 0), 8);
    }
    const last = plan.pages.at(-1)?.sourceRectCss;
    expect(last).toBeDefined();
    expect((last?.y ?? 0) + (last?.height ?? 0)).toBeCloseTo(source.y + source.height, 8);
    expect(plan.pages.reduce((sum, page) => sum + page.sourceRectCss.height, 0)).toBeCloseTo(
      source.height,
      8,
    );
  });

  it("keeps one output page per detected source page without splitting", () => {
    const pages = planPdfDocumentPages(
      {
        schemaVersion: 1,
        strategy: "dom",
        confidence: 1,
        complete: true,
        sourcePageCount: 2,
        pages: [
          { index: 0, sourceRectCss: { x: 120, y: 20, width: 800, height: 1132 } },
          { index: 1, sourceRectCss: { x: 40, y: 1180, width: 1132, height: 800 } },
        ],
      },
      DEFAULT_CAPTURE_SETTINGS.pdf,
    );

    expect(pages).toHaveLength(2);
    expect(pages[0]?.sourceRectCss).toEqual({ x: 120, y: 20, width: 800, height: 1132 });
    expect(pages[1]?.sourceRectCss).toEqual({ x: 40, y: 1180, width: 1132, height: 800 });
    expect(pages[0]?.pageHeightPt).toBeGreaterThan(pages[0]?.pageWidthPt ?? 0);
    expect(pages[1]?.pageWidthPt).toBeGreaterThan(pages[1]?.pageHeightPt ?? 0);
    expect(pages.every((page) => page.imageRectPt.width > 0 && page.imageRectPt.height > 0)).toBe(
      true,
    );
  });

  it("carries fractional pixel residuals and reaches the exact final pixel", () => {
    const ranges = createRunningPixelRanges([333.333, 333.333, 333.334], 1.25, 1250);

    expect(ranges).toHaveLength(3);
    expect(ranges[0]).toMatchObject({ start: 0, end: 417, length: 417 });
    expect(ranges[1]?.start).toBe(ranges[0]?.end);
    expect(ranges[2]?.start).toBe(ranges[1]?.end);
    expect(ranges.at(-1)?.end).toBe(1250);
    expect(ranges.reduce((sum, range) => sum + range.length, 0)).toBe(1250);
  });
});
