export interface PdfMultipartPart {
  partIndex: number;
  startPageIndex: number;
  endPageIndexExclusive: number;
  pageCount: number;
  estimatedBytes: number;
}

export interface PdfMultipartPlan {
  parts: PdfMultipartPart[];
  totalPages: number;
  estimatedBytes: number;
}

export interface PdfMultipartPlannerOptions {
  maxPartBytes: number;
  fixedPartOverheadBytes?: number;
  perPageOverheadBytes?: number;
}

const DEFAULT_FIXED_PART_OVERHEAD_BYTES = 16 * 1024;
const DEFAULT_PER_PAGE_OVERHEAD_BYTES = 2 * 1024;

function safePositiveInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value));
}

export function planPdfMultipart(
  pageEstimatedBytes: readonly number[],
  options: PdfMultipartPlannerOptions,
): PdfMultipartPlan {
  if (pageEstimatedBytes.length === 0) {
    return { parts: [], totalPages: 0, estimatedBytes: 0 };
  }
  const maxPartBytes = safePositiveInteger(options.maxPartBytes);
  const fixedOverhead = Math.max(
    0,
    Math.floor(options.fixedPartOverheadBytes ?? DEFAULT_FIXED_PART_OVERHEAD_BYTES),
  );
  const pageOverhead = Math.max(
    0,
    Math.floor(options.perPageOverheadBytes ?? DEFAULT_PER_PAGE_OVERHEAD_BYTES),
  );
  const normalized = pageEstimatedBytes.map((bytes) => safePositiveInteger(bytes));
  const parts: PdfMultipartPart[] = [];
  let start = 0;
  let bytes = fixedOverhead;

  const pushPart = (endExclusive: number): void => {
    parts.push({
      partIndex: parts.length,
      startPageIndex: start,
      endPageIndexExclusive: endExclusive,
      pageCount: endExclusive - start,
      estimatedBytes: bytes,
    });
    start = endExclusive;
    bytes = fixedOverhead;
  };

  for (let pageIndex = 0; pageIndex < normalized.length; pageIndex += 1) {
    const pageBytes = normalized[pageIndex] ?? 1;
    const addition = pageBytes + pageOverhead;
    if (pageIndex > start && bytes + addition > maxPartBytes) {
      pushPart(pageIndex);
    }
    // A single logical page is indivisible. If it is larger than the configured part budget,
    // it remains a one-page part and the caller's page-local safety policy decides whether it
    // can be written or must pause.
    bytes += addition;
    if (bytes > maxPartBytes && pageIndex === start) {
      pushPart(pageIndex + 1);
    }
  }
  if (start < normalized.length) pushPart(normalized.length);

  return {
    parts,
    totalPages: normalized.length,
    estimatedBytes: parts.reduce((total, part) => total + part.estimatedBytes, 0),
  };
}

export function multipartPdfFilename(
  filename: string,
  part: Pick<PdfMultipartPart, "partIndex" | "startPageIndex" | "endPageIndexExclusive">,
  partCount: number,
): string {
  const stem = filename.toLowerCase().endsWith(".pdf") ? filename.slice(0, -4) : filename;
  const digits = Math.max(3, String(Math.max(1, partCount)).length);
  const partNumber = String(part.partIndex + 1).padStart(digits, "0");
  const firstPage = String(part.startPageIndex + 1).padStart(4, "0");
  const lastPage = String(part.endPageIndexExclusive).padStart(4, "0");
  return `${stem}.part-${partNumber}-pages-${firstPage}-${lastPage}.pdf`;
}
