import type { DebuggerSession } from "@background/debugger-client";
import { normalizePageMetrics, readPageMetrics } from "@capture/page-metrics";
import { WebCapRuntimeError } from "@shared/errors/error";

const cssLayoutMetrics = {
  cssContentSize: { x: 0, y: 0, width: 1_200.5, height: 30_000.25 },
  cssLayoutViewport: { pageX: 12, pageY: 34, clientWidth: 900, clientHeight: 600 },
  cssVisualViewport: {
    offsetX: 0,
    offsetY: 0,
    pageX: 12,
    pageY: 34,
    clientWidth: 720,
    clientHeight: 480,
    scale: 1.1,
    zoom: 1.25,
  },
};

describe("page metrics", () => {
  it("normalizes CSS layout metrics and device pixel ratio", () => {
    const metrics = normalizePageMetrics({
      layoutMetrics: cssLayoutMetrics,
      devicePixelRatioResult: { result: { type: "number", value: 2.5 } },
    });

    expect(metrics).toEqual({
      document: { x: 0, y: 0, width: 1_200.5, height: 30_000.25 },
      layoutViewport: { x: 12, y: 34, width: 900, height: 600 },
      visualViewport: { x: 12, y: 34, width: 720, height: 480, scale: 1.1 },
      devicePixelRatio: 2.5,
      zoomFactor: 1.25,
      scrollX: 12,
      scrollY: 34,
    });
  });

  it("prefers CSS metrics over deprecated device-pixel fields", () => {
    const metrics = normalizePageMetrics({
      layoutMetrics: {
        ...cssLayoutMetrics,
        contentSize: { x: 0, y: 0, width: 8, height: 8 },
        layoutViewport: { pageX: 0, pageY: 0, clientWidth: 8, clientHeight: 8 },
        visualViewport: {
          pageX: 0,
          pageY: 0,
          clientWidth: 8,
          clientHeight: 8,
          scale: 1,
        },
      },
      devicePixelRatioResult: { result: { value: 2 } },
    });

    expect(metrics.document.width).toBe(1_200.5);
    expect(metrics.layoutViewport.width).toBe(900);
  });

  it("falls back to legacy layout fields when CSS fields are absent", () => {
    const metrics = normalizePageMetrics({
      layoutMetrics: {
        contentSize: { x: 0, y: 0, width: 1000, height: 2000 },
        layoutViewport: { pageX: 10, pageY: 20, clientWidth: 800, clientHeight: 500 },
        visualViewport: {
          pageX: 10,
          pageY: 20,
          clientWidth: 800,
          clientHeight: 500,
          scale: 1,
        },
      },
      devicePixelRatioResult: { result: { value: 1 } },
    });

    expect(metrics.document).toEqual({ x: 0, y: 0, width: 1000, height: 2000 });
    expect(metrics.zoomFactor).toBe(1);
  });

  it("rejects missing or malformed metrics", () => {
    expect(() =>
      normalizePageMetrics({
        layoutMetrics: {},
        devicePixelRatioResult: { result: { value: 0 } },
      }),
    ).toThrowError(WebCapRuntimeError);
  });

  it("enables Page and requests layout metrics plus DPR", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const session: DebuggerSession = {
      tabId: 1,
      async sendCommand<T>(method: string, params?: Record<string, unknown>): Promise<T> {
        calls.push({ method, ...(params === undefined ? {} : { params }) });
        if (method === "Page.getLayoutMetrics") {
          return cssLayoutMetrics as T;
        }
        if (method === "Runtime.evaluate") {
          return { result: { value: 2 } } as T;
        }
        return undefined as T;
      },
    };

    await expect(readPageMetrics(session)).resolves.toMatchObject({
      devicePixelRatio: 2,
      zoomFactor: 1.25,
    });
    expect(calls.map(({ method }) => method)).toEqual([
      "Page.enable",
      "Page.getLayoutMetrics",
      "Runtime.evaluate",
    ]);
    expect(calls[2]?.params).toMatchObject({ expression: "window.devicePixelRatio" });
  });
});
