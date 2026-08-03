import { z } from "zod";

import type { DebuggerSession } from "@background/debugger-client";
import type { PageMetrics, Rect } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

const FiniteNumberSchema = z.number().finite();
const PositiveFiniteNumberSchema = FiniteNumberSchema.positive();

const ProtocolRectSchema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    width: PositiveFiniteNumberSchema,
    height: PositiveFiniteNumberSchema,
  })
  .passthrough();

const LayoutViewportSchema = z
  .object({
    pageX: FiniteNumberSchema,
    pageY: FiniteNumberSchema,
    clientWidth: PositiveFiniteNumberSchema,
    clientHeight: PositiveFiniteNumberSchema,
  })
  .passthrough();

const VisualViewportSchema = LayoutViewportSchema.extend({
  offsetX: FiniteNumberSchema.optional(),
  offsetY: FiniteNumberSchema.optional(),
  scale: PositiveFiniteNumberSchema,
  zoom: PositiveFiniteNumberSchema.optional(),
}).passthrough();

const LayoutMetricsResponseSchema = z
  .object({
    cssContentSize: ProtocolRectSchema.optional(),
    contentSize: ProtocolRectSchema.optional(),
    cssLayoutViewport: LayoutViewportSchema.optional(),
    layoutViewport: LayoutViewportSchema.optional(),
    cssVisualViewport: VisualViewportSchema.optional(),
    visualViewport: VisualViewportSchema.optional(),
  })
  .passthrough();

const RuntimeEvaluateResponseSchema = z
  .object({
    result: z
      .object({
        value: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export interface RawPageMeasurement {
  layoutMetrics: unknown;
  devicePixelRatioResult: unknown;
}

function measurementError(message: string, causeCode: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_CDP_COMMAND",
      stage: "measure",
      message,
      userMessageKey: "errors.measure.invalidMetrics",
      retryable: true,
      fallbackAllowed: true,
      causeCode,
    }),
  );
}

function viewportRect(viewport: z.infer<typeof LayoutViewportSchema>): Rect {
  return {
    x: viewport.pageX,
    y: viewport.pageY,
    width: viewport.clientWidth,
    height: viewport.clientHeight,
  };
}

export function normalizePageMetrics(measurement: RawPageMeasurement): PageMetrics {
  const layoutResult = LayoutMetricsResponseSchema.safeParse(measurement.layoutMetrics);
  if (!layoutResult.success) {
    throw measurementError(
      "Chrome returned malformed page layout metrics.",
      "InvalidLayoutMetrics",
    );
  }

  const dprResult = RuntimeEvaluateResponseSchema.safeParse(measurement.devicePixelRatioResult);
  if (!dprResult.success) {
    throw measurementError("Chrome returned a malformed device pixel ratio.", "InvalidDprResult");
  }

  const content = layoutResult.data.cssContentSize ?? layoutResult.data.contentSize;
  const layoutViewport = layoutResult.data.cssLayoutViewport ?? layoutResult.data.layoutViewport;
  const visualViewport = layoutResult.data.cssVisualViewport ?? layoutResult.data.visualViewport;
  const devicePixelRatio = dprResult.data.result.value;

  if (content === undefined || layoutViewport === undefined || visualViewport === undefined) {
    throw measurementError(
      "Chrome did not provide the required CSS page metrics.",
      "MissingLayoutMetrics",
    );
  }

  if (
    typeof devicePixelRatio !== "number" ||
    !Number.isFinite(devicePixelRatio) ||
    devicePixelRatio <= 0
  ) {
    throw measurementError("Chrome returned an invalid device pixel ratio.", "InvalidDprValue");
  }

  const documentRight = Math.max(
    content.x + content.width,
    layoutViewport.pageX + layoutViewport.clientWidth,
  );
  const documentBottom = Math.max(
    content.y + content.height,
    layoutViewport.pageY + layoutViewport.clientHeight,
  );

  return {
    document: {
      x: content.x,
      y: content.y,
      width: documentRight - content.x,
      height: documentBottom - content.y,
    },
    layoutViewport: viewportRect(layoutViewport),
    visualViewport: {
      ...viewportRect(visualViewport),
      scale: visualViewport.scale,
    },
    devicePixelRatio,
    zoomFactor: visualViewport.zoom ?? 1,
    scrollX: layoutViewport.pageX,
    scrollY: layoutViewport.pageY,
  };
}

export async function readPageMetrics(session: DebuggerSession): Promise<PageMetrics> {
  await session.sendCommand("Page.enable", undefined, {
    stage: "measure",
    userMessageKey: "errors.measure.pageEnable",
  });

  const [layoutMetrics, devicePixelRatioResult] = await Promise.all([
    session.sendCommand("Page.getLayoutMetrics", undefined, {
      stage: "measure",
      userMessageKey: "errors.measure.layoutMetrics",
    }),
    session.sendCommand(
      "Runtime.evaluate",
      {
        expression: "window.devicePixelRatio",
        returnByValue: true,
        silent: true,
      },
      {
        stage: "measure",
        userMessageKey: "errors.measure.devicePixelRatio",
      },
    ),
  ]);

  return normalizePageMetrics({ layoutMetrics, devicePixelRatioResult });
}
