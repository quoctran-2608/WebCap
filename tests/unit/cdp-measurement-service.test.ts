import { describe, expect, it, vi } from "vitest";

import type { DebuggerClient, DebuggerSession } from "@background/debugger-client";
import { CdpMeasurementService } from "@capture/cdp-measurement-service";

const layoutMetrics = {
  cssContentSize: { x: 0, y: 0, width: 9000, height: 20_000 },
  cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 900, clientHeight: 600 },
  cssVisualViewport: {
    pageX: 0,
    pageY: 0,
    clientWidth: 900,
    clientHeight: 600,
    scale: 1,
    zoom: 1.25,
  },
};

describe("CdpMeasurementService", () => {
  it("measures and plans inside one owned debugger session", async () => {
    const session: DebuggerSession = {
      tabId: 4,
      sendCommand<T>(method: string): Promise<T> {
        if (method === "Page.getLayoutMetrics") {
          return Promise.resolve(layoutMetrics as T);
        }
        if (method === "Runtime.evaluate") {
          return Promise.resolve({ result: { value: 2 } } as T);
        }
        return Promise.resolve(undefined as T);
      },
    };
    const withSession = vi.fn(
      (_tabId: number, task: (value: DebuggerSession) => Promise<unknown>) => task(session),
    );
    const debuggerClient = { withSession } as unknown as DebuggerClient;
    const service = new CdpMeasurementService(debuggerClient);

    const result = await service.measureAndPlan({
      tabId: 4,
      jobId: "job-cdp",
      limits: { maxTiles: 256 },
    });

    expect(withSession).toHaveBeenCalledTimes(1);
    expect(result.metrics.document).toEqual({ x: 0, y: 0, width: 9000, height: 20_000 });
    expect(result.plan.columnCount).toBe(2);
    expect(result.plan.rowCount).toBeGreaterThan(2);
    expect(result.plan.tiles[0]?.jobId).toBe("job-cdp");
  });
});
