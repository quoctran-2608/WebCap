import type { DebuggerClient, DebuggerSession } from "@background/debugger-client";
import type {
  CaptureEngine,
  CaptureEngineContext,
  CaptureEngineResult,
} from "@capture/capture-engine";
import { readPageMetrics } from "@capture/page-metrics";
import { planCaptureTiles } from "@capture/tile-planner";
import {
  CDP_TILE_MAX_ATTEMPTS,
  CDP_TILE_RETRY_DELAYS_MS,
  TILE_MAX_PIXEL_AREA,
  TILE_TARGET_HEIGHT_CSS,
  TILE_TARGET_WIDTH_CSS,
} from "@shared/constants";
import type { CaptureTile, PageMetrics, Rect } from "@shared/contracts/domain";
import {
  WebCapRuntimeError,
  createWebCapError,
  createWebCapRuntimeError,
} from "@shared/errors/error";

interface CaptureScreenshotResponse {
  data?: unknown;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

function base64ToBlob(value: string): Blob {
  const decoded = globalThis.atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return new Blob([bytes], { type: "image/png" });
}

function captureEmptyError(tile: CaptureTile): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_CAPTURE_EMPTY",
      stage: "capture",
      message: "Chrome returned an empty screenshot tile.",
      userMessageKey: "errors.captureEmpty",
      retryable: true,
      fallbackAllowed: true,
      causeCode: "EmptyCdpScreenshot",
      safeContext: { tileIndex: tile.index },
    }),
  );
}

function isRetryable(error: unknown): boolean {
  return error instanceof WebCapRuntimeError ? error.retryable : true;
}

function boundedTarget(metrics: PageMetrics, context: CaptureEngineContext): Rect {
  const requested = context.targetRect ?? metrics.document;
  const maxRight =
    metrics.document.x + Math.min(metrics.document.width, context.settings.limits.maxCssWidth);
  const maxBottom =
    metrics.document.y + Math.min(metrics.document.height, context.settings.limits.maxCssHeight);
  const x = Math.max(metrics.document.x, requested.x);
  const y = Math.max(metrics.document.y, requested.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(requested.x + requested.width, maxRight) - x),
    height: Math.max(0, Math.min(requested.y + requested.height, maxBottom) - y),
  };
}

export class CdpCaptureEngine implements CaptureEngine {
  readonly kind = "cdp" as const;

  constructor(private readonly debuggerClient: DebuggerClient) {}

  capture(context: CaptureEngineContext): Promise<CaptureEngineResult> {
    return this.debuggerClient.withSession(context.tabId, (session) =>
      this.captureWithSession(session, context),
    );
  }

  private async captureWithSession(
    session: DebuggerSession,
    context: CaptureEngineContext,
  ): Promise<CaptureEngineResult> {
    context.cancellation.throwIfCancelled("measure");
    await context.reportProgress({
      jobId: context.jobId,
      state: "preparing",
      stage: "measuring",
      completed: 0,
      total: 0,
    });
    const metrics = await readPageMetrics(session);
    context.cancellation.throwIfCancelled("plan");

    const targetRect = boundedTarget(metrics, context);
    await context.reportProgress({
      jobId: context.jobId,
      state: "preparing",
      stage: "planning",
      completed: 0,
      total: 0,
    });
    const plan = planCaptureTiles({
      jobId: context.jobId,
      documentBounds: metrics.document,
      targetRect,
      pixelScale: metrics.zoomFactor,
      limits: {
        maxTileWidthCss: TILE_TARGET_WIDTH_CSS,
        maxTileHeightCss: TILE_TARGET_HEIGHT_CSS,
        maxTilePixelArea: TILE_MAX_PIXEL_AREA,
        maxTiles: context.settings.limits.maxTiles,
      },
    });
    const partialCapture = plan.limitedByMaxTiles
      ? {
          reason: "max-tiles" as const,
          capturedRect: plan.targetRect,
          limitValue: context.settings.limits.maxTiles,
        }
      : undefined;
    await context.onPlan(metrics, plan.targetRect, plan.tiles, partialCapture);

    const storedTiles: CaptureTile[] = [];
    for (const tile of plan.tiles) {
      context.cancellation.throwIfCancelled("capture");
      await context.reportProgress({
        jobId: context.jobId,
        state: "capturing",
        stage: "capturing",
        completed: storedTiles.length,
        total: plan.tiles.length,
        tileIndex: tile.index,
      });
      const captured = await this.captureTile(session, tile, context);
      context.cancellation.throwIfCancelled("capture");
      await context.reportProgress({
        jobId: context.jobId,
        state: "capturing",
        stage: "storing",
        completed: storedTiles.length,
        total: plan.tiles.length,
        tileIndex: tile.index,
      });
      await context.storeTile(captured.tile, captured.blob);
      storedTiles.push(captured.tile);
    }

    return {
      metrics,
      targetRect: plan.targetRect,
      tiles: storedTiles,
      ...(partialCapture === undefined ? {} : { partialCapture }),
    };
  }

  private async captureTile(
    session: DebuggerSession,
    tile: CaptureTile,
    context: CaptureEngineContext,
  ): Promise<{ tile: CaptureTile; blob: Blob }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= CDP_TILE_MAX_ATTEMPTS; attempt += 1) {
      context.cancellation.throwIfCancelled("capture");
      try {
        const response = await session.sendCommand<CaptureScreenshotResponse>(
          "Page.captureScreenshot",
          {
            format: "png",
            fromSurface: true,
            captureBeyondViewport: true,
            optimizeForSpeed: true,
            clip: {
              x: tile.sourceRectCss.x,
              y: tile.sourceRectCss.y,
              width: tile.sourceRectCss.width,
              height: tile.sourceRectCss.height,
              scale: 1,
            },
          },
          {
            stage: "capture",
            retryable: true,
            fallbackAllowed: true,
            userMessageKey: "errors.cdp.captureTile",
          },
        );
        if (typeof response.data !== "string" || response.data.length === 0) {
          throw captureEmptyError(tile);
        }
        const blob = base64ToBlob(response.data);
        if (blob.size === 0) {
          throw captureEmptyError(tile);
        }
        return {
          blob,
          tile: {
            ...tile,
            status: "stored",
            attempts: attempt,
            byteLength: blob.size,
            mimeType: "image/png",
          },
        };
      } catch (error) {
        lastError = error;
        if (attempt >= CDP_TILE_MAX_ATTEMPTS || !isRetryable(error)) {
          throw error;
        }
        const delay = CDP_TILE_RETRY_DELAYS_MS[attempt - 1];
        if (delay !== undefined) {
          await wait(delay);
        }
      }
    }
    throw lastError;
  }
}
