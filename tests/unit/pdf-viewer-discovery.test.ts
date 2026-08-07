import { describe, expect, it } from "vitest";

import {
  finalizePdfViewerDiscovery,
  type PdfViewerDiscoverySnapshot,
  type PdfViewerPageCandidate,
} from "@background/pdf-viewer-discovery";

function virtualizedCandidate(index: number, y: number): PdfViewerPageCandidate {
  const landscape = index % 7 === 3;
  return {
    rect: {
      x: 80,
      y,
      width: landscape ? 900 : 620,
      height: landscape ? 620 : 900,
    },
    adapter: "virtualized",
    confidence: 0.9,
    sampleIndex: Math.floor(index / 4),
    declaredIndex: index,
  };
}

describe("finalizePdfViewerDiscovery", () => {
  it("discovers a 500-page virtualized document without simultaneous DOM pages", () => {
    const candidates: PdfViewerPageCandidate[] = [];
    let y = 0;
    for (let index = 0; index < 500; index += 1) {
      const candidate = virtualizedCandidate(index, y);
      candidates.push(candidate);
      y += candidate.rect.height + 18;
    }
    const snapshot: PdfViewerDiscoverySnapshot = {
      adapter: "virtualized",
      declaredPageCount: 500,
      scrollWidth: 1100,
      scrollHeight: y - 18,
      clientHeight: 800,
      reachedStart: true,
      reachedEnd: true,
      stableEndRounds: 3,
      candidates,
    };

    const result = finalizePdfViewerDiscovery(snapshot);
    expect(result).toBeDefined();
    expect(result).toMatchObject({
      strategy: "dom",
      complete: true,
      sourcePageCount: 500,
    });
    expect(result?.pages).toHaveLength(500);
    expect(result?.pages[3]?.sourceRectCss).toMatchObject({ width: 900, height: 620 });
    expect(result?.pages[4]?.sourceRectCss).toMatchObject({ width: 620, height: 900 });
  });

  it("rejects declared completion when one logical page was never observed", () => {
    const candidates: PdfViewerPageCandidate[] = [];
    let y = 0;
    for (let index = 0; index < 12; index += 1) {
      const candidate = virtualizedCandidate(index, y);
      if (index !== 7) candidates.push(candidate);
      y += candidate.rect.height + 16;
    }

    expect(
      finalizePdfViewerDiscovery({
        adapter: "virtualized",
        declaredPageCount: 12,
        scrollWidth: 1100,
        scrollHeight: y - 16,
        clientHeight: 800,
        reachedStart: true,
        reachedEnd: true,
        stableEndRounds: 3,
        candidates,
      }),
    ).toBeUndefined();
  });

  it("accepts a canvas-only visual sequence only with stable start/end proof", () => {
    const candidates: PdfViewerPageCandidate[] = [0, 1, 2, 3].map((index) => ({
      rect: { x: 120, y: index * 820, width: 600, height: 800 },
      adapter: "canvas-visual" as const,
      confidence: 0.76,
      sampleIndex: index,
    }));
    const complete = finalizePdfViewerDiscovery({
      adapter: "canvas-visual",
      scrollWidth: 900,
      scrollHeight: 3260,
      clientHeight: 720,
      reachedStart: true,
      reachedEnd: true,
      stableEndRounds: 3,
      candidates,
    });
    expect(complete).toMatchObject({ complete: true, sourcePageCount: 4 });

    expect(
      finalizePdfViewerDiscovery({
        adapter: "canvas-visual",
        scrollWidth: 900,
        scrollHeight: 3260,
        clientHeight: 720,
        reachedStart: true,
        reachedEnd: false,
        stableEndRounds: 0,
        candidates,
      }),
    ).toBeUndefined();
  });

  it("deduplicates recycled page geometry while preserving distinct adjacent pages", () => {
    const candidates: PdfViewerPageCandidate[] = [
      {
        rect: { x: 100, y: 0, width: 600, height: 800 },
        adapter: "canvas-visual",
        confidence: 0.76,
        sampleIndex: 0,
      },
      {
        rect: { x: 100, y: 1, width: 600, height: 800 },
        adapter: "canvas-visual",
        confidence: 0.78,
        sampleIndex: 1,
      },
      {
        rect: { x: 100, y: 820, width: 600, height: 800 },
        adapter: "canvas-visual",
        confidence: 0.76,
        sampleIndex: 1,
      },
    ];
    const result = finalizePdfViewerDiscovery({
      adapter: "canvas-visual",
      scrollWidth: 900,
      scrollHeight: 1620,
      clientHeight: 720,
      reachedStart: true,
      reachedEnd: true,
      stableEndRounds: 3,
      candidates,
    });
    expect(result?.pages).toHaveLength(2);
    expect(result?.pages[0]?.sourceRectCss.y).toBe(1);
    expect(result?.pages[1]?.sourceRectCss.y).toBe(820);
  });
});
