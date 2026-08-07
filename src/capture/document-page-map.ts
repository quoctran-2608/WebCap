import type { DocumentPageMap, Rect } from "@shared/contracts/domain";

const PAGE_EPSILON_CSS = 2;
const MIN_PAGE_EDGE_CSS = 96;
const MAX_PROJECTED_PAGES = 10_000;

export interface DocumentPageCandidate {
  rect: Rect;
  declaredIndex?: number;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const value = ordered[middle];
  if (value === undefined) return 0;
  if (ordered.length % 2 === 1) return value;
  return ((ordered[middle - 1] ?? value) + value) / 2;
}

function relativeSpread(values: readonly number[], center: number): number {
  if (values.length === 0 || center <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(...values.map((value) => Math.abs(value - center) / center));
}

function overlapsSamePage(left: Rect, right: Rect): boolean {
  const intersectionWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const intersection = intersectionWidth * intersectionHeight;
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller > 0 && intersection / smaller >= 0.8;
}

function sanitizeCandidate(
  candidate: DocumentPageCandidate,
  scrollWidth: number,
  scrollHeight: number,
): DocumentPageCandidate | undefined {
  const rect = candidate.rect;
  if (
    !finitePositive(rect.width) ||
    !finitePositive(rect.height) ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    rect.width < MIN_PAGE_EDGE_CSS ||
    rect.height < MIN_PAGE_EDGE_CSS
  ) {
    return undefined;
  }
  const left = Math.max(0, Math.min(scrollWidth, rect.x));
  const top = Math.max(0, Math.min(scrollHeight, rect.y));
  const right = Math.max(left, Math.min(scrollWidth, rect.x + rect.width));
  const bottom = Math.max(top, Math.min(scrollHeight, rect.y + rect.height));
  if (right - left < MIN_PAGE_EDGE_CSS || bottom - top < MIN_PAGE_EDGE_CSS) return undefined;
  return {
    rect: { x: left, y: top, width: right - left, height: bottom - top },
    ...(candidate.declaredIndex === undefined ||
    !Number.isInteger(candidate.declaredIndex) ||
    candidate.declaredIndex < 0
      ? {}
      : { declaredIndex: candidate.declaredIndex }),
  };
}

export function buildDocumentPageMap(options: {
  candidates: readonly DocumentPageCandidate[];
  scrollWidth: number;
  scrollHeight: number;
  declaredPageCount?: number;
}): DocumentPageMap | undefined {
  if (!finitePositive(options.scrollWidth) || !finitePositive(options.scrollHeight)) {
    return undefined;
  }

  const ordered = options.candidates
    .map((candidate) => sanitizeCandidate(candidate, options.scrollWidth, options.scrollHeight))
    .filter((candidate): candidate is DocumentPageCandidate => candidate !== undefined)
    .sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x);

  const deduplicated: DocumentPageCandidate[] = [];
  for (const candidate of ordered) {
    const previous = deduplicated.at(-1);
    if (previous !== undefined && overlapsSamePage(previous.rect, candidate.rect)) {
      if (
        candidate.rect.width * candidate.rect.height >
        previous.rect.width * previous.rect.height
      ) {
        deduplicated[deduplicated.length - 1] = candidate;
      }
      continue;
    }
    deduplicated.push(candidate);
  }
  if (deduplicated.length < 2) return undefined;

  const heights = deduplicated.map((candidate) => candidate.rect.height);
  const widths = deduplicated.map((candidate) => candidate.rect.width);
  const gaps = deduplicated.slice(1).map((candidate, index) => {
    const previous = deduplicated[index];
    return Math.max(0, candidate.rect.y - ((previous?.rect.y ?? 0) + (previous?.rect.height ?? 0)));
  });
  const medianHeight = median(heights);
  const medianWidth = median(widths);
  const medianGap = median(gaps);
  const first = deduplicated[0]?.rect;
  const last = deduplicated.at(-1)?.rect;
  if (first === undefined || last === undefined) return undefined;

  const declaredIndexes = deduplicated
    .map((candidate) => candidate.declaredIndex)
    .filter((value): value is number => value !== undefined);
  const candidateDeclaredPageCount =
    declaredIndexes.length === 0 ? undefined : Math.max(...declaredIndexes) + 1;
  const declaredPageCount =
    options.declaredPageCount !== undefined &&
    Number.isInteger(options.declaredPageCount) &&
    options.declaredPageCount > 0
      ? Math.max(options.declaredPageCount, candidateDeclaredPageCount ?? 0)
      : candidateDeclaredPageCount;
  const edgeTolerance = Math.max(64, medianGap * 2, medianHeight * 0.08);
  const coversTop = first.y <= edgeTolerance;
  const coversBottom = last.y + last.height >= options.scrollHeight - edgeTolerance;
  const declaredComplete =
    declaredPageCount !== undefined &&
    declaredPageCount === deduplicated.length &&
    new Set(declaredIndexes).size === deduplicated.length;

  if ((coversTop && coversBottom) || declaredComplete) {
    return {
      schemaVersion: 1,
      strategy: "dom",
      confidence: declaredComplete ? 1 : 0.96,
      complete: true,
      sourcePageCount: deduplicated.length,
      pages: deduplicated.map((candidate, index) => ({
        index,
        sourceRectCss: candidate.rect,
      })),
    };
  }

  const uniformEnough =
    relativeSpread(heights, medianHeight) <= 0.08 &&
    relativeSpread(widths, medianWidth) <= 0.08 &&
    (gaps.length === 0 || relativeSpread(gaps, Math.max(1, medianGap)) <= 0.35);
  const stride = medianHeight + medianGap;
  if (!uniformEnough || stride <= MIN_PAGE_EDGE_CSS) return undefined;

  const inferredCount = Math.round((options.scrollHeight - first.y + medianGap) / stride);
  const pageCount = Math.max(declaredPageCount ?? 0, inferredCount, deduplicated.length);
  if (pageCount < 2 || pageCount > MAX_PROJECTED_PAGES) return undefined;

  const pages = Array.from({ length: pageCount }, (_, index) => {
    const y = first.y + index * stride;
    const bottom = Math.min(options.scrollHeight, y + medianHeight);
    return {
      index,
      sourceRectCss: {
        x: Math.max(0, Math.min(options.scrollWidth - medianWidth, first.x)),
        y,
        width: Math.min(medianWidth, options.scrollWidth),
        height: Math.max(0, bottom - y),
      },
    };
  }).filter((page) => page.sourceRectCss.height >= MIN_PAGE_EDGE_CSS - PAGE_EPSILON_CSS);

  if (pages.length !== pageCount) return undefined;
  const projectedBottom = pages.at(-1);
  if (
    projectedBottom === undefined ||
    projectedBottom.sourceRectCss.y + projectedBottom.sourceRectCss.height <
      options.scrollHeight - edgeTolerance
  ) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    strategy: "projected",
    confidence: 0.82,
    complete: true,
    sourcePageCount: pages.length,
    pages,
  };
}
