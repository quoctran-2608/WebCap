import { PDFDocument } from "pdf-lib";

import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

export interface PdfExpectedPageSize {
  widthPt: number;
  heightPt: number;
}

export interface PdfIntegrityExpectations {
  pageCount?: number | undefined;
  pageSizes?: PdfExpectedPageSize[] | undefined;
  dimensionTolerancePt?: number | undefined;
  requireImagePerPage?: boolean | undefined;
}

export interface PdfIntegrityPage {
  index: number;
  widthPt: number;
  heightPt: number;
}

export interface PdfIntegrityReport {
  valid: boolean;
  byteLength: number;
  signatureValid: boolean;
  pageCount: number;
  pages: PdfIntegrityPage[];
  imageObjectCount: number;
  nonEmptyStreamCount: number;
  errors: string[];
}

function bytesOf(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function countMatches(value: string, expression: RegExp): number {
  let count = 0;
  for (const _match of value.matchAll(expression)) count += 1;
  return count;
}

function countNonEmptyStreams(value: string): number {
  let count = 0;
  for (const match of value.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const payload = match[1];
    if (payload !== undefined && payload.trim().length > 0) count += 1;
  }
  return count;
}

function dimensionMatches(actual: number, expected: number, tolerance: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function addError(errors: string[], error: string): void {
  if (!errors.includes(error)) errors.push(error);
}

export async function inspectPdfIntegrity(
  input: Uint8Array | ArrayBuffer,
  expectations: PdfIntegrityExpectations = {},
): Promise<PdfIntegrityReport> {
  const bytes = bytesOf(input);
  const signatureValid = hasPdfSignature(bytes);
  const errors: string[] = [];
  if (!signatureValid) addError(errors, "signature");
  if (bytes.byteLength === 0) addError(errors, "empty-file");

  const raw = new TextDecoder("latin1").decode(bytes);
  const imageObjectCount = countMatches(raw, /\/Subtype\s*\/Image\b/g);
  const nonEmptyStreamCount = countNonEmptyStreams(raw);

  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = document.getPages().map((page, index) => ({
      index,
      widthPt: page.getWidth(),
      heightPt: page.getHeight(),
    }));
    const pageCount = pages.length;

    if (pageCount <= 0) addError(errors, "page-count-empty");
    if (expectations.pageCount !== undefined && pageCount !== expectations.pageCount) {
      addError(errors, "page-count-mismatch");
    }

    const tolerance = expectations.dimensionTolerancePt ?? 0.5;
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw new TypeError("dimensionTolerancePt must be a finite non-negative number.");
    }
    if (expectations.pageSizes !== undefined) {
      if (expectations.pageSizes.length !== pageCount) {
        addError(errors, "page-size-count-mismatch");
      }
      for (const [index, expected] of expectations.pageSizes.entries()) {
        const page = pages[index];
        if (
          page === undefined ||
          !dimensionMatches(page.widthPt, expected.widthPt, tolerance) ||
          !dimensionMatches(page.heightPt, expected.heightPt, tolerance)
        ) {
          addError(errors, `page-size-${index + 1}`);
        }
      }
    }

    if (expectations.requireImagePerPage !== false) {
      if (imageObjectCount < pageCount) addError(errors, "image-object-count");
      if (nonEmptyStreamCount < imageObjectCount) addError(errors, "empty-image-stream");
    }

    return {
      valid: errors.length === 0,
      byteLength: bytes.byteLength,
      signatureValid,
      pageCount,
      pages,
      imageObjectCount,
      nonEmptyStreamCount,
      errors,
    };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("dimensionTolerancePt")) throw error;
    addError(errors, "load-failed");
    return {
      valid: false,
      byteLength: bytes.byteLength,
      signatureValid,
      pageCount: 0,
      pages: [],
      imageObjectCount,
      nonEmptyStreamCount,
      errors,
    };
  }
}

export async function assertPdfIntegrity(
  input: Uint8Array | ArrayBuffer,
  expectations: PdfIntegrityExpectations = {},
): Promise<PdfIntegrityReport> {
  const report = await inspectPdfIntegrity(input, expectations);
  if (report.valid) return report;

  throw createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message:
        "The generated PDF failed integrity validation. The source capture remains available so the export can be retried.",
      userMessageKey: "errors.exportFailed",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "PdfIntegrityCheckFailed",
      safeContext: {
        errors: report.errors.join(","),
        byteLength: report.byteLength,
        pageCount: report.pageCount,
        expectedPageCount: expectations.pageCount ?? -1,
        imageObjectCount: report.imageObjectCount,
        nonEmptyStreamCount: report.nonEmptyStreamCount,
      },
    }),
  );
}
