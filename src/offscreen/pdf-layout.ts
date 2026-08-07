import type { CaptureSettings, DocumentPageMap, Rect } from "@shared/contracts/domain";

export const PDF_POINTS_PER_INCH = 72;
export const PDF_MILLIMETERS_PER_INCH = 25.4;
export const CSS_PIXELS_PER_INCH = 96;

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const LETTER_WIDTH_IN = 8.5;
const LETTER_HEIGHT_IN = 11;
const COVERAGE_EPSILON = 1e-7;

export interface PdfPageBox {
  widthPt: number;
  heightPt: number;
  marginTopPt: number;
  marginRightPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  printableWidthPt: number;
  printableHeightPt: number;
}

export interface PdfPageSlice {
  index: number;
  sourceRectCss: Rect;
  pageWidthPt: number;
  pageHeightPt: number;
  imageRectPt: Rect;
}

export interface RunningPixelRange {
  index: number;
  start: number;
  end: number;
  length: number;
  residual: number;
}

export interface PdfDocumentPlan {
  pageBox: PdfPageBox;
  scalePtPerCss: number;
  sourceHeightCssPerPage: number;
  pages: PdfPageSlice[];
}

export function mmToPt(millimeters: number): number {
  if (!Number.isFinite(millimeters)) {
    throw new TypeError("PDF millimeters must be finite.");
  }
  return (millimeters / PDF_MILLIMETERS_PER_INCH) * PDF_POINTS_PER_INCH;
}

export function inchesToPt(inches: number): number {
  if (!Number.isFinite(inches)) {
    throw new TypeError("PDF inches must be finite.");
  }
  return inches * PDF_POINTS_PER_INCH;
}

export function cssPxToPt(cssPixels: number): number {
  if (!Number.isFinite(cssPixels)) {
    throw new TypeError("CSS pixels must be finite.");
  }
  return (cssPixels / CSS_PIXELS_PER_INCH) * PDF_POINTS_PER_INCH;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
  return value;
}

function orient(
  widthPt: number,
  heightPt: number,
  orientation: CaptureSettings["pdf"]["orientation"],
): { widthPt: number; heightPt: number } {
  const portrait =
    widthPt <= heightPt ? { widthPt, heightPt } : { widthPt: heightPt, heightPt: widthPt };
  return orientation === "portrait"
    ? portrait
    : { widthPt: portrait.heightPt, heightPt: portrait.widthPt };
}

export function resolvePdfPageBox(
  settings: CaptureSettings["pdf"],
  sourceWidthCss: number,
): PdfPageBox {
  const sourceWidth = positive(sourceWidthCss, "PDF source width");
  const marginPt = mmToPt(settings.marginMm);
  let dimensions: { widthPt: number; heightPt: number };

  switch (settings.pageSize) {
    case "a4":
      dimensions = orient(mmToPt(A4_WIDTH_MM), mmToPt(A4_HEIGHT_MM), settings.orientation);
      break;
    case "letter":
      dimensions = orient(
        inchesToPt(LETTER_WIDTH_IN),
        inchesToPt(LETTER_HEIGHT_IN),
        settings.orientation,
      );
      break;
    case "fit-width": {
      const printableWidthPt = cssPxToPt(sourceWidth);
      const portraitRatio = mmToPt(A4_HEIGHT_MM) / mmToPt(A4_WIDTH_MM);
      const ratio = settings.orientation === "portrait" ? portraitRatio : 1 / portraitRatio;
      dimensions = {
        widthPt: printableWidthPt + marginPt * 2,
        heightPt: (printableWidthPt + marginPt * 2) * ratio,
      };
      break;
    }
  }

  const printableWidthPt = dimensions.widthPt - marginPt * 2;
  const printableHeightPt = dimensions.heightPt - marginPt * 2;
  positive(printableWidthPt, "PDF printable width");
  positive(printableHeightPt, "PDF printable height");

  return {
    widthPt: dimensions.widthPt,
    heightPt: dimensions.heightPt,
    marginTopPt: marginPt,
    marginRightPt: marginPt,
    marginBottomPt: marginPt,
    marginLeftPt: marginPt,
    printableWidthPt,
    printableHeightPt,
  };
}

export function planPdfDocument(
  sourceRectCss: Rect,
  settings: CaptureSettings["pdf"],
): PdfDocumentPlan {
  const sourceWidth = positive(sourceRectCss.width, "PDF source width");
  const sourceHeight = positive(sourceRectCss.height, "PDF source height");
  const pageBox = resolvePdfPageBox(settings, sourceWidth);
  const scalePtPerCss = pageBox.printableWidthPt / sourceWidth;
  const sourceHeightCssPerPage = pageBox.printableHeightPt / scalePtPerCss;
  positive(sourceHeightCssPerPage, "PDF source height per page");

  const pages: PdfPageSlice[] = [];
  let offsetCss = 0;
  while (sourceHeight - offsetCss > COVERAGE_EPSILON) {
    const remainingCss = sourceHeight - offsetCss;
    const pageSourceHeightCss = Math.min(sourceHeightCssPerPage, remainingCss);
    const renderedHeightPt = pageSourceHeightCss * scalePtPerCss;
    pages.push({
      index: pages.length,
      sourceRectCss: {
        x: sourceRectCss.x,
        y: sourceRectCss.y + offsetCss,
        width: sourceWidth,
        height: pageSourceHeightCss,
      },
      pageWidthPt: pageBox.widthPt,
      pageHeightPt: pageBox.heightPt,
      imageRectPt: {
        x: pageBox.marginLeftPt,
        y: pageBox.heightPt - pageBox.marginTopPt - renderedHeightPt,
        width: pageBox.printableWidthPt,
        height: renderedHeightPt,
      },
    });
    offsetCss += pageSourceHeightCss;
  }

  if (pages.length === 0) {
    throw new RangeError("PDF document plan must contain at least one page.");
  }
  const finalBottom = pages.at(-1)?.sourceRectCss;
  if (
    finalBottom === undefined ||
    Math.abs(finalBottom.y + finalBottom.height - (sourceRectCss.y + sourceHeight)) >
      COVERAGE_EPSILON
  ) {
    throw new RangeError("PDF page plan does not cover the complete source height.");
  }

  return { pageBox, scalePtPerCss, sourceHeightCssPerPage, pages };
}

export function planPdfDocumentPages(
  pageMap: DocumentPageMap,
  settings: CaptureSettings["pdf"],
): PdfPageSlice[] {
  if (pageMap.pages.length === 0 || pageMap.pages.length !== pageMap.sourcePageCount) {
    throw new RangeError("Document page map must contain every source page.");
  }
  return pageMap.pages.map((documentPage, index) => {
    const source = documentPage.sourceRectCss;
    const orientation = source.width > source.height ? "landscape" : "portrait";
    const pageBox = resolvePdfPageBox({ ...settings, orientation }, source.width);
    const scalePtPerCss = Math.min(
      pageBox.printableWidthPt / positive(source.width, "PDF source page width"),
      pageBox.printableHeightPt / positive(source.height, "PDF source page height"),
    );
    const imageWidthPt = source.width * scalePtPerCss;
    const imageHeightPt = source.height * scalePtPerCss;
    return {
      index,
      sourceRectCss: source,
      pageWidthPt: pageBox.widthPt,
      pageHeightPt: pageBox.heightPt,
      imageRectPt: {
        x: pageBox.marginLeftPt + (pageBox.printableWidthPt - imageWidthPt) / 2,
        y: pageBox.marginBottomPt + (pageBox.printableHeightPt - imageHeightPt) / 2,
        width: imageWidthPt,
        height: imageHeightPt,
      },
    };
  });
}

export function createRunningPixelRanges(
  pageHeightsCss: readonly number[],
  pixelScale: number,
  totalPixels: number,
): RunningPixelRange[] {
  const scale = positive(pixelScale, "PDF render pixel scale");
  const targetTotal = Math.round(positive(totalPixels, "PDF total pixel height"));
  if (pageHeightsCss.length === 0) {
    throw new RangeError("PDF pixel ranges require at least one page.");
  }

  const ranges: RunningPixelRange[] = [];
  let start = 0;
  let residual = 0;
  for (let index = 0; index < pageHeightsCss.length; index += 1) {
    const heightCss = positive(pageHeightsCss[index] ?? 0, "PDF page source height");
    const isLast = index === pageHeightsCss.length - 1;
    const exactLength = heightCss * scale + residual;
    const roundedLength = isLast ? targetTotal - start : Math.max(1, Math.round(exactLength));
    const end = start + roundedLength;
    residual = exactLength - roundedLength;
    ranges.push({ index, start, end, length: roundedLength, residual });
    start = end;
  }

  if (start !== targetTotal || ranges.some((range) => range.length <= 0)) {
    throw new RangeError("PDF pixel ranges do not cover the target pixel height exactly.");
  }
  return ranges;
}
