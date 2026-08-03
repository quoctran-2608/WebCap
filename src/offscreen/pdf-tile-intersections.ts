import type { CaptureTile, Rect } from "@shared/contracts/domain";

const COVERAGE_EPSILON = 1e-6;

export interface PdfTileIntersection {
  tileIndex: number;
  tileId: string;
  logicalRectCss: Rect;
  sourceCropCss: Rect;
  pageDestinationCss: Rect;
}

function right(rect: Rect): number {
  return rect.x + rect.width;
}

function bottom(rect: Rect): number {
  return rect.y + rect.height;
}

function intersect(left: Rect, rightRect: Rect): Rect | undefined {
  const x = Math.max(left.x, rightRect.x);
  const y = Math.max(left.y, rightRect.y);
  const intersectionRight = Math.min(right(left), right(rightRect));
  const intersectionBottom = Math.min(bottom(left), bottom(rightRect));
  if (intersectionRight - x <= COVERAGE_EPSILON || intersectionBottom - y <= COVERAGE_EPSILON) {
    return undefined;
  }
  return {
    x,
    y,
    width: intersectionRight - x,
    height: intersectionBottom - y,
  };
}

export function resolveTileOutputRect(tile: CaptureTile): Rect {
  if (tile.outputRectCss !== undefined) {
    return tile.outputRectCss;
  }
  const overlapRight = tile.overlapRightCss ?? 0;
  const overlapBottom = tile.overlapBottomCss ?? 0;
  return {
    x: tile.sourceRectCss.x + tile.overlapLeftCss,
    y: tile.sourceRectCss.y + tile.overlapTopCss,
    width: tile.sourceRectCss.width - tile.overlapLeftCss - overlapRight,
    height: tile.sourceRectCss.height - tile.overlapTopCss - overlapBottom,
  };
}

function overlapArea(left: Rect, rightRect: Rect): number {
  const intersection = intersect(left, rightRect);
  return intersection === undefined ? 0 : intersection.width * intersection.height;
}

function assertCoverage(pageRectCss: Rect, intersections: readonly PdfTileIntersection[]): void {
  const pageArea = pageRectCss.width * pageRectCss.height;
  const coveredArea = intersections.reduce(
    (sum, item) => sum + item.logicalRectCss.width * item.logicalRectCss.height,
    0,
  );
  const tolerance = Math.max(COVERAGE_EPSILON, pageArea * 1e-8);
  if (Math.abs(coveredArea - pageArea) > tolerance) {
    throw new RangeError("PDF tile intersections do not cover the complete page source rectangle.");
  }

  for (let leftIndex = 0; leftIndex < intersections.length; leftIndex += 1) {
    const left = intersections[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < intersections.length; rightIndex += 1) {
      const rightItem = intersections[rightIndex];
      if (rightItem === undefined) continue;
      if (overlapArea(left.logicalRectCss, rightItem.logicalRectCss) > tolerance) {
        throw new RangeError("PDF tile intersections overlap inside a page source rectangle.");
      }
    }
  }
}

export function planPdfTileIntersections(
  pageRectCss: Rect,
  tiles: readonly CaptureTile[],
): PdfTileIntersection[] {
  if (pageRectCss.width <= 0 || pageRectCss.height <= 0) {
    throw new RangeError("PDF page source rectangle must be non-empty.");
  }

  const intersections = tiles
    .map((tile): PdfTileIntersection | undefined => {
      const outputRect = resolveTileOutputRect(tile);
      if (outputRect.width <= 0 || outputRect.height <= 0) {
        throw new RangeError(`Tile ${tile.index} has an empty PDF output rectangle.`);
      }
      const logicalRectCss = intersect(pageRectCss, outputRect);
      if (logicalRectCss === undefined) {
        return undefined;
      }
      return {
        tileIndex: tile.index,
        tileId: tile.id,
        logicalRectCss,
        sourceCropCss: {
          x: logicalRectCss.x - tile.sourceRectCss.x,
          y: logicalRectCss.y - tile.sourceRectCss.y,
          width: logicalRectCss.width,
          height: logicalRectCss.height,
        },
        pageDestinationCss: {
          x: logicalRectCss.x - pageRectCss.x,
          y: logicalRectCss.y - pageRectCss.y,
          width: logicalRectCss.width,
          height: logicalRectCss.height,
        },
      };
    })
    .filter((item): item is PdfTileIntersection => item !== undefined)
    .sort((left, right) => left.tileIndex - right.tileIndex);

  if (intersections.length === 0) {
    throw new RangeError("No stored capture tile intersects the PDF page source rectangle.");
  }
  assertCoverage(pageRectCss, intersections);
  return intersections;
}
