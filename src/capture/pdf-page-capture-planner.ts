import { TILE_COVERAGE_EPSILON_CSS } from "@shared/constants";
import type { CaptureTile, Rect } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

export interface PdfPageTileEstimate {
  rows: number;
  columns: number;
  tileCount: number;
}

export interface PdfPageCapturePlan extends PdfPageTileEstimate {
  pageIndex: number;
  pageRect: Rect;
  tiles: CaptureTile[];
}

interface AxisPlan {
  stops: number[];
  total: number;
}

function plannerError(
  message: string,
  causeCode: string,
  safeContext: Record<string, number>,
): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_TILE_PLAN",
      stage: "plan",
      message,
      userMessageKey: "errors.tilePlan",
      retryable: false,
      fallbackAllowed: false,
      causeCode,
      safeContext,
    }),
  );
}

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw plannerError(`PDF page ${label} must be positive and finite.`, "PdfPagePlanInvalidInput", {
      value,
    });
  }
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function axisPlan(options: {
  pageStart: number;
  pageExtent: number;
  documentExtent: number;
  viewportExtent: number;
  overlap: number;
  materialize: boolean;
}): AxisPlan {
  const pageEnd = options.pageStart + options.pageExtent;
  const maximumScroll = Math.max(0, options.documentExtent - options.viewportExtent);
  let firstScroll = clamp(options.pageStart, 0, maximumScroll);

  if (options.pageExtent <= options.viewportExtent + TILE_COVERAGE_EPSILON_CSS) {
    if (pageEnd > firstScroll + options.viewportExtent + TILE_COVERAGE_EPSILON_CSS) {
      firstScroll = clamp(pageEnd - options.viewportExtent, 0, maximumScroll);
    }
    return { stops: options.materialize ? [firstScroll] : [], total: 1 };
  }

  const lastScroll = clamp(pageEnd - options.viewportExtent, 0, maximumScroll);
  const safeOverlap = Math.min(
    Math.max(0, options.overlap),
    Math.max(0, options.viewportExtent - 1),
  );
  const step = Math.max(1, options.viewportExtent - safeOverlap);
  const distance = Math.max(0, lastScroll - firstScroll);
  const total = Math.max(
    1,
    Math.ceil((distance - TILE_COVERAGE_EPSILON_CSS) / step) + 1,
  );
  if (!options.materialize) return { stops: [], total };

  return {
    total,
    stops: Array.from({ length: total }, (_, index) =>
      index === total - 1 ? lastScroll : Math.min(lastScroll, firstScroll + index * step),
    ),
  };
}

function validatePageRect(pageRect: Rect, documentWidth: number, documentHeight: number): void {
  requirePositive(pageRect.width, "width");
  requirePositive(pageRect.height, "height");
  if (!Number.isFinite(pageRect.x) || !Number.isFinite(pageRect.y) || pageRect.x < 0 || pageRect.y < 0) {
    throw plannerError("PDF page position must be finite and non-negative.", "PdfPagePlanInvalidPosition", {
      x: pageRect.x,
      y: pageRect.y,
    });
  }
  if (
    pageRect.x + pageRect.width > documentWidth + TILE_COVERAGE_EPSILON_CSS ||
    pageRect.y + pageRect.height > documentHeight + TILE_COVERAGE_EPSILON_CSS
  ) {
    throw plannerError("PDF page rectangle exceeds the verified viewer extent.", "PdfPageOutsideViewer", {
      pageRight: pageRect.x + pageRect.width,
      pageBottom: pageRect.y + pageRect.height,
      documentWidth,
      documentHeight,
    });
  }
}

export function estimatePdfPageCaptureTiles(options: {
  pageRect: Rect;
  documentWidth: number;
  documentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  overlapCss: number;
}): PdfPageTileEstimate {
  const documentWidth = requirePositive(options.documentWidth, "viewer width");
  const documentHeight = requirePositive(options.documentHeight, "viewer height");
  const viewportWidth = requirePositive(options.viewportWidth, "viewport width");
  const viewportHeight = requirePositive(options.viewportHeight, "viewport height");
  validatePageRect(options.pageRect, documentWidth, documentHeight);

  const x = axisPlan({
    pageStart: options.pageRect.x,
    pageExtent: options.pageRect.width,
    documentExtent: documentWidth,
    viewportExtent: viewportWidth,
    overlap: options.overlapCss,
    materialize: false,
  });
  const y = axisPlan({
    pageStart: options.pageRect.y,
    pageExtent: options.pageRect.height,
    documentExtent: documentHeight,
    viewportExtent: viewportHeight,
    overlap: options.overlapCss,
    materialize: false,
  });
  return { rows: y.total, columns: x.total, tileCount: x.total * y.total };
}

export function planPdfPageCaptureTiles(options: {
  jobId: string;
  pageIndex: number;
  pageRect: Rect;
  documentWidth: number;
  documentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  pixelScale: number;
  overlapCss: number;
  startTileIndex: number;
  maxTilesPerPage: number;
}): PdfPageCapturePlan {
  if (!Number.isInteger(options.pageIndex) || options.pageIndex < 0) {
    throw plannerError("PDF page index must be a non-negative integer.", "PdfPageIndexInvalid", {
      pageIndex: options.pageIndex,
    });
  }
  if (!Number.isInteger(options.startTileIndex) || options.startTileIndex < 0) {
    throw plannerError("PDF tile index must be a non-negative integer.", "PdfTileIndexInvalid", {
      tileIndex: options.startTileIndex,
    });
  }
  const maxTilesPerPage = Math.floor(requirePositive(options.maxTilesPerPage, "tile budget"));
  const pixelScale = requirePositive(options.pixelScale, "pixel scale");
  const estimate = estimatePdfPageCaptureTiles(options);
  if (estimate.tileCount > maxTilesPerPage) {
    throw plannerError(
      "One logical PDF page exceeds the bounded page-local tile budget.",
      "PdfPageTileBudgetExceeded",
      {
        pageIndex: options.pageIndex,
        requiredTiles: estimate.tileCount,
        maxTilesPerPage,
      },
    );
  }

  const x = axisPlan({
    pageStart: options.pageRect.x,
    pageExtent: options.pageRect.width,
    documentExtent: options.documentWidth,
    viewportExtent: options.viewportWidth,
    overlap: options.overlapCss,
    materialize: true,
  });
  const y = axisPlan({
    pageStart: options.pageRect.y,
    pageExtent: options.pageRect.height,
    documentExtent: options.documentHeight,
    viewportExtent: options.viewportHeight,
    overlap: options.overlapCss,
    materialize: true,
  });

  const pageRight = options.pageRect.x + options.pageRect.width;
  const pageBottom = options.pageRect.y + options.pageRect.height;
  const tiles: CaptureTile[] = [];
  for (let row = 0; row < y.stops.length; row += 1) {
    const scrollY = y.stops[row] as number;
    const previousBottom =
      row === 0 ? options.pageRect.y : (y.stops[row - 1] as number) + options.viewportHeight;
    const outputY = Math.max(options.pageRect.y, previousBottom, scrollY);
    const outputBottom = Math.min(pageBottom, scrollY + options.viewportHeight);

    for (let column = 0; column < x.stops.length; column += 1) {
      const scrollX = x.stops[column] as number;
      const previousRight =
        column === 0 ? options.pageRect.x : (x.stops[column - 1] as number) + options.viewportWidth;
      const outputX = Math.max(options.pageRect.x, previousRight, scrollX);
      const outputRight = Math.min(pageRight, scrollX + options.viewportWidth);
      const index = options.startTileIndex + row * x.stops.length + column;
      tiles.push({
        id: `${options.jobId}:${index}`,
        jobId: options.jobId,
        index,
        row,
        column,
        sourceRectCss: {
          x: scrollX,
          y: scrollY,
          width: options.viewportWidth,
          height: options.viewportHeight,
        },
        outputRectCss: {
          x: outputX,
          y: outputY,
          width: outputRight - outputX,
          height: outputBottom - outputY,
        },
        scrollXCss: scrollX,
        scrollYCss: scrollY,
        expectedPixelWidth: Math.max(1, Math.round(options.viewportWidth * pixelScale)),
        expectedPixelHeight: Math.max(1, Math.round(options.viewportHeight * pixelScale)),
        overlapTopCss: Math.max(0, outputY - scrollY),
        overlapLeftCss: Math.max(0, outputX - scrollX),
        overlapRightCss: Math.max(0, scrollX + options.viewportWidth - outputRight),
        overlapBottomCss: Math.max(0, scrollY + options.viewportHeight - outputBottom),
        status: "planned",
        attempts: 0,
      });
    }
  }

  return {
    pageIndex: options.pageIndex,
    pageRect: options.pageRect,
    rows: estimate.rows,
    columns: estimate.columns,
    tileCount: estimate.tileCount,
    tiles,
  };
}
