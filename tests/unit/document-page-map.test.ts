import { describe, expect, it } from "vitest";

import { buildDocumentPageMap } from "@capture/document-page-map";

describe("document page map", () => {
  it("keeps complete explicit PDF page rectangles", () => {
    const result = buildDocumentPageMap({
      scrollWidth: 1000,
      scrollHeight: 2400,
      candidates: [
        { rect: { x: 100, y: 20, width: 800, height: 1100 }, declaredIndex: 0 },
        { rect: { x: 100, y: 1180, width: 800, height: 1100 }, declaredIndex: 1 },
      ],
      declaredPageCount: 2,
    });

    expect(result).toMatchObject({
      strategy: "dom",
      complete: true,
      sourcePageCount: 2,
      pages: [
        { index: 0, sourceRectCss: { x: 100, y: 20, width: 800, height: 1100 } },
        { index: 1, sourceRectCss: { x: 100, y: 1180, width: 800, height: 1100 } },
      ],
    });
  });

  it("projects 126 virtualized pages from a stable page rhythm", () => {
    const result = buildDocumentPageMap({
      scrollWidth: 1000,
      scrollHeight: 126 * 1200,
      declaredPageCount: 126,
      candidates: [
        { rect: { x: 100, y: 0, width: 800, height: 1100 }, declaredIndex: 0 },
        { rect: { x: 100, y: 1200, width: 800, height: 1100 }, declaredIndex: 1 },
        { rect: { x: 100, y: 2400, width: 800, height: 1100 }, declaredIndex: 2 },
      ],
    });

    expect(result).toMatchObject({
      strategy: "projected",
      complete: true,
      sourcePageCount: 126,
    });
    expect(result?.pages).toHaveLength(126);
    expect(result?.pages.at(-1)?.index).toBe(125);
  });

  it("rejects irregular non-document candidates instead of guessing", () => {
    const result = buildDocumentPageMap({
      scrollWidth: 1200,
      scrollHeight: 8000,
      candidates: [
        { rect: { x: 20, y: 100, width: 300, height: 400 } },
        { rect: { x: 500, y: 900, width: 650, height: 900 } },
        { rect: { x: 50, y: 2800, width: 1000, height: 300 } },
      ],
    });

    expect(result).toBeUndefined();
  });
});
