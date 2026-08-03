import { afterEach, describe, expect, it, vi } from "vitest";

import type { DebuggerClient, DebuggerSession } from "@background/debugger-client";
import type { CaptureCancellation, CaptureProgress } from "@capture/capture-engine";
import { CdpCaptureEngine } from "@capture/cdp-capture-engine";
import type { CaptureTile } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

function layoutMetrics(width: number, height: number) {
  return {
    cssContentSize: { x: 0, y: 0, width, height },
    cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 900, clientHeight: 600 },
    cssVisualViewport: {
      pageX: 0,
      pageY: 0,
      clientWidth: 900,
      clientHeight: 600,
      scale: 1,
      zoom: 1,
    },
  };
}

function cancellation(): CaptureCancellation {
  return {
    cancelled: false,
    throwIfCancelled: () => undefined,
  };
}

function sessionFor(options: {
  width: number;
  height: number;
  capture: (tileIndex: number) => Promise<unknown>;
}): { session: DebuggerSession; captureCalls: Array<Record<string, unknown>> } {
  const captureCalls: Array<Record<string, unknown>> = [];
  const session: DebuggerSession = {
    tabId: 7,
    async sendCommand<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      if (method === "Page.getLayoutMetrics") {
        return layoutMetrics(options.width, options.height) as T;
      }
      if (method === "Runtime.evaluate") {
        return { result: { value: 1 } } as T;
      }
      if (method === "Page.captureScreenshot") {
        captureCalls.push(params ?? {});
        return (await options.capture(captureCalls.length - 1)) as T;
      }
      return undefined as T;
    },
  };
  return { session, captureCalls };
}

function engineFor(session: DebuggerSession): {
  engine: CdpCaptureEngine;
  withSession: ReturnType<typeof vi.fn>;
} {
  const withSession = vi.fn((_tabId: number, task: (value: DebuggerSession) => Promise<unknown>) =>
    task(session),
  );
  const debuggerClient = { withSession } as unknown as DebuggerClient;
  return { engine: new CdpCaptureEngine(debuggerClient), withSession };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CdpCaptureEngine", () => {
  it("captures and stores a deterministic multi-tile plan in one debugger session", async () => {
    const { session, captureCalls } = sessionFor({
      width: 9_000,
      height: 10_000,
      capture: () => Promise.resolve({ data: "AQID" }),
    });
    const { engine, withSession } = engineFor(session);
    const planned: CaptureTile[][] = [];
    const stored: Array<{ tile: CaptureTile; blob: Blob }> = [];
    const progress: CaptureProgress[] = [];

    const result = await engine.capture({
      jobId: "job-multi",
      tabId: 7,
      settings: DEFAULT_CAPTURE_SETTINGS,
      cancellation: cancellation(),
      onPlan: (_metrics, _target, tiles) => {
        planned.push(tiles);
        return Promise.resolve();
      },
      storeTile: (tile, blob) => {
        stored.push({ tile, blob });
        return Promise.resolve();
      },
      reportProgress: (event) => {
        progress.push(event);
      },
    });

    expect(withSession).toHaveBeenCalledTimes(1);
    expect(result.tiles).toHaveLength(4);
    expect(planned[0]?.map((tile) => tile.index)).toEqual([0, 1, 2, 3]);
    expect(stored.map(({ tile }) => tile.index)).toEqual([0, 1, 2, 3]);
    expect(stored.every(({ tile }) => tile.status === "stored" && tile.attempts === 1)).toBe(true);
    expect(stored.every(({ blob }) => blob.type === "image/png" && blob.size === 3)).toBe(true);
    expect(captureCalls).toHaveLength(4);
    expect(captureCalls[0]).toMatchObject({
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      optimizeForSpeed: true,
      clip: { x: 0, y: 0, width: 8_192, height: 8_192, scale: 1 },
    });
    expect(progress.some((event) => event.stage === "measuring")).toBe(true);
    expect(progress.some((event) => event.stage === "storing" && event.tileIndex === 3)).toBe(true);
  });

  it("retries transient capture failures with the bounded backoff policy", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const { session } = sessionFor({
      width: 100,
      height: 100,
      capture: () => {
        attempts += 1;
        return attempts < 3
          ? Promise.reject(new Error("temporary CDP failure"))
          : Promise.resolve({ data: "AQID" });
      },
    });
    const { engine } = engineFor(session);
    const stored: CaptureTile[] = [];

    const capture = engine.capture({
      jobId: "job-retry",
      tabId: 7,
      settings: DEFAULT_CAPTURE_SETTINGS,
      cancellation: cancellation(),
      onPlan: () => Promise.resolve(),
      storeTile: (tile) => {
        stored.push(tile);
        return Promise.resolve();
      },
      reportProgress: () => undefined,
    });
    await vi.runAllTimersAsync();
    await capture;

    expect(attempts).toBe(3);
    expect(stored[0]?.attempts).toBe(3);
  });

  it("checks cancellation before starting the next tile", async () => {
    let cancelled = false;
    const token: CaptureCancellation = {
      get cancelled() {
        return cancelled;
      },
      throwIfCancelled(stage = "capture") {
        if (cancelled) {
          throw createWebCapRuntimeError(
            createWebCapError({
              code: "E_CANCELLED",
              stage,
              message: "cancelled",
              userMessageKey: "errors.cancelled",
            }),
          );
        }
      },
    };
    const { session } = sessionFor({
      width: 9_000,
      height: 10_000,
      capture: () => Promise.resolve({ data: "AQID" }),
    });
    const { engine } = engineFor(session);
    const stored: number[] = [];

    await expect(
      engine.capture({
        jobId: "job-cancel",
        tabId: 7,
        settings: DEFAULT_CAPTURE_SETTINGS,
        cancellation: token,
        onPlan: () => Promise.resolve(),
        storeTile: (tile) => {
          stored.push(tile.index);
          cancelled = true;
          return Promise.resolve();
        },
        reportProgress: () => undefined,
      }),
    ).rejects.toMatchObject({ name: "E_CANCELLED" });

    expect(stored).toEqual([0]);
  });
});
