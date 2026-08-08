import { describe, expect, it } from "vitest";

import {
  finalizePdfViewerDiscovery,
  type PdfViewerDiscoverySnapshot,
  type PdfViewerPageCandidate,
} from "@background/pdf-viewer-discovery";

function declaredCandidate(
  index: number,
  y: number,
  renderState: "ready" | "unknown" | "placeholder" = "ready",
): PdfViewerPageCandidate {
  return {
    rect: { x: 60, y, width: 620, height: 800 },
    adapter: "virtualized",
    confidence: 0.9,
    sampleIndex: index,
    declaredIndex: index,
    renderState,
  };
}

function snapshot(
  candidates: PdfViewerPageCandidate[],
  declaredPageCount: number,
): PdfViewerDiscoverySnapshot {
  return {
    adapter: "virtualized",
    declaredPageCount,
    scrollWidth: 760,
    scrollHeight: declaredPageCount * 820 - 20,
    clientHeight: 720,
    reachedStart: true,
    reachedEnd: true,
    stableEndRounds: 3,
    candidates,
  };
}

describe("S34 difficult PDF viewer hardening", () => {
  it("rejects a declared document while one logical page is still a renderer placeholder", () => {
    const candidates = [0, 1, 2, 3].map((index) =>
      declaredCandidate(index, index * 820, index === 2 ? "placeholder" : "ready"),
    );

    expect(finalizePdfViewerDiscovery(snapshot(candidates, 4))).toBeUndefined();
  });

  it("prefers ready evidence when a recycled logical page replaces its placeholder", () => {
    const candidates = [
      declaredCandidate(0, 0),
      declaredCandidate(1, 820, "placeholder"),
      {
        ...declaredCandidate(1, 820, "ready"),
        sampleIndex: 4,
        confidence: 0.88,
      },
      declaredCandidate(2, 1640),
    ];

    const result = finalizePdfViewerDiscovery(snapshot(candidates, 3));
    expect(result).toMatchObject({ complete: true, sourcePageCount: 3 });
    expect(result?.pages.map((page) => page.index)).toEqual([0, 1, 2]);
  });

  it("retains a legitimate blank page and duplicate-looking adjacent pages by declared identity", () => {
    const candidates = [
      declaredCandidate(0, 0, "ready"),
      declaredCandidate(1, 820, "ready"),
      declaredCandidate(2, 1640, "ready"),
      declaredCandidate(3, 2460, "ready"),
    ];

    const result = finalizePdfViewerDiscovery(snapshot(candidates, 4));
    expect(result?.pages).toHaveLength(4);
    expect(result?.pages[1]?.sourceRectCss).toEqual({ x: 60, y: 820, width: 620, height: 800 });
    expect(result?.pages[2]?.sourceRectCss).toEqual({ x: 60, y: 1640, width: 620, height: 800 });
  });

  it("rejects repeated canvas geometry when every canvas is still a placeholder surface", () => {
    const candidates: PdfViewerPageCandidate[] = [0, 1, 2].flatMap((index) => [
      {
        rect: { x: 70, y: index * 820, width: 620, height: 800 },
        adapter: "canvas-visual" as const,
        confidence: 0.76,
        sampleIndex: index,
        renderState: "placeholder" as const,
      },
      {
        rect: { x: 70, y: index * 820, width: 620, height: 800 },
        adapter: "canvas-visual" as const,
        confidence: 0.76,
        sampleIndex: index + 1,
        renderState: "placeholder" as const,
      },
    ]);

    expect(
      finalizePdfViewerDiscovery({
        adapter: "canvas-visual",
        scrollWidth: 760,
        scrollHeight: 2440,
        clientHeight: 720,
        reachedStart: true,
        reachedEnd: true,
        stableEndRounds: 3,
        candidates,
      }),
    ).toBeUndefined();
  });

  it("soaks repeated 2000-page virtualized finalization without losing page identity", () => {
    const candidates: PdfViewerPageCandidate[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      candidates.push(declaredCandidate(index, index * 820, "ready"));
    }
    const input = snapshot(candidates, 2_000);

    for (let round = 0; round < 12; round += 1) {
      const result = finalizePdfViewerDiscovery(input);
      expect(result?.sourcePageCount).toBe(2_000);
      expect(result?.pages[0]?.index).toBe(0);
      expect(result?.pages.at(-1)?.index).toBe(1_999);
    }
  });
});
