import { describe, expect, it } from "vitest";

import { multipartPdfFilename, planPdfMultipart } from "@offscreen/pdf-multipart-planner";

describe("planPdfMultipart", () => {
  it("keeps a small document as one contiguous logical-page part", () => {
    expect(
      planPdfMultipart([10, 10, 10], {
        maxPartBytes: 100,
        fixedPartOverheadBytes: 0,
        perPageOverheadBytes: 0,
      }).parts,
    ).toEqual([
      {
        partIndex: 0,
        startPageIndex: 0,
        endPageIndexExclusive: 3,
        pageCount: 3,
        estimatedBytes: 30,
      },
    ]);
  });

  it("splits only between logical pages and covers the source exactly once", () => {
    const plan = planPdfMultipart([35, 35, 35, 35, 35], {
      maxPartBytes: 80,
      fixedPartOverheadBytes: 0,
      perPageOverheadBytes: 0,
    });

    expect(plan.parts).toEqual([
      {
        partIndex: 0,
        startPageIndex: 0,
        endPageIndexExclusive: 2,
        pageCount: 2,
        estimatedBytes: 70,
      },
      {
        partIndex: 1,
        startPageIndex: 2,
        endPageIndexExclusive: 4,
        pageCount: 2,
        estimatedBytes: 70,
      },
      {
        partIndex: 2,
        startPageIndex: 4,
        endPageIndexExclusive: 5,
        pageCount: 1,
        estimatedBytes: 35,
      },
    ]);
    expect(plan.parts.flatMap((part) =>
      Array.from({ length: part.pageCount }, (_, offset) => part.startPageIndex + offset),
    )).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps an oversized logical page indivisible", () => {
    const plan = planPdfMultipart([200, 10], {
      maxPartBytes: 100,
      fixedPartOverheadBytes: 0,
      perPageOverheadBytes: 0,
    });
    expect(plan.parts.map((part) => [part.startPageIndex, part.endPageIndexExclusive])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("uses deterministic page-range part filenames", () => {
    expect(
      multipartPdfFilename(
        "capture.pdf",
        { partIndex: 1, startPageIndex: 200, endPageIndexExclusive: 400 },
        12,
      ),
    ).toBe("capture.part-002-pages-0201-0400.pdf");
  });
});
