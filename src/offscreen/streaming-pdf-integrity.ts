import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

const MAX_XREF_READ_BYTES = 2 * 1024 * 1024;

export interface StreamingPdfIntegrityReport {
  valid: boolean;
  pageCount: number;
  objectCount: number;
  byteLength: number;
  xrefOffset: number;
  errors: string[];
}

function integrityError(message: string, causeCode: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message,
      userMessageKey: "errors.exportFailed",
      retryable: true,
      fallbackAllowed: false,
      causeCode,
    }),
  );
}

function expectedObjectCount(pageCount: number): number {
  return 3 + pageCount * 3;
}

function pageObjectNumber(pageIndex: number): number {
  return 3 + pageIndex * 3;
}

function parseXrefOffsets(text: string, expectedSize: number): number[] | undefined {
  const lines = text.replace(/\r/gu, "").split("\n");
  if (lines[0] !== "xref" || lines[1] !== `0 ${expectedSize}`) return undefined;
  if (lines[2] !== "0000000000 65535 f ") return undefined;
  const offsets = new Array<number>(expectedSize).fill(-1);
  offsets[0] = 0;
  for (let objectNumber = 1; objectNumber < expectedSize; objectNumber += 1) {
    const line = lines[objectNumber + 2];
    if (line === undefined) return undefined;
    const match = /^(\d{10}) 00000 n $/u.exec(line);
    if (match?.[1] === undefined) return undefined;
    offsets[objectNumber] = Number.parseInt(match[1], 10);
  }
  return offsets;
}

function nextOffset(offsets: readonly number[], current: number, fallback: number): number {
  let next = fallback;
  for (const offset of offsets) {
    if (offset > current && offset < next) next = offset;
  }
  return next;
}

export async function inspectStreamingPdfStructure(
  blob: Blob,
  expectedPageCount: number,
): Promise<StreamingPdfIntegrityReport> {
  if (!Number.isInteger(expectedPageCount) || expectedPageCount <= 0) {
    throw integrityError("Streamed PDF validation requires a positive expected page count.", "StreamingPdfExpectedPageCountInvalid");
  }
  if (blob.size <= 0) {
    throw integrityError("The streamed PDF artifact is empty.", "StreamingPdfArtifactEmpty");
  }

  const errors: string[] = [];
  const header = await blob.slice(0, Math.min(blob.size, 16)).text();
  if (!header.startsWith("%PDF-1.7")) errors.push("header");

  const tailStart = Math.max(0, blob.size - MAX_XREF_READ_BYTES);
  const tail = await blob.slice(tailStart).text();
  const startMatch = /startxref\s+(\d+)\s+%%EOF\s*$/u.exec(tail);
  const xrefOffset = startMatch?.[1] === undefined ? -1 : Number.parseInt(startMatch[1], 10);
  if (!Number.isInteger(xrefOffset) || xrefOffset <= 0 || xrefOffset >= blob.size) {
    errors.push("startxref");
    return {
      valid: false,
      pageCount: 0,
      objectCount: 0,
      byteLength: blob.size,
      xrefOffset: Math.max(0, xrefOffset),
      errors,
    };
  }
  if (blob.size - xrefOffset > MAX_XREF_READ_BYTES) {
    errors.push("xref-too-large");
    return {
      valid: false,
      pageCount: 0,
      objectCount: 0,
      byteLength: blob.size,
      xrefOffset,
      errors,
    };
  }

  const xrefText = await blob.slice(xrefOffset).text();
  const expectedSize = expectedObjectCount(expectedPageCount);
  const offsets = parseXrefOffsets(xrefText, expectedSize);
  if (offsets === undefined) {
    errors.push("xref");
    return {
      valid: false,
      pageCount: 0,
      objectCount: 0,
      byteLength: blob.size,
      xrefOffset,
      errors,
    };
  }
  if (!xrefText.includes(`trailer\n<< /Size ${expectedSize} /Root 1 0 R >>`)) {
    errors.push("trailer");
  }
  for (let objectNumber = 1; objectNumber < offsets.length; objectNumber += 1) {
    const offset = offsets[objectNumber];
    if (offset === undefined || offset <= 0 || offset >= xrefOffset) {
      errors.push(`offset-${objectNumber}`);
      break;
    }
  }

  const pagesOffset = offsets[2] ?? -1;
  const catalogOffset = offsets[1] ?? -1;
  if (pagesOffset <= 0 || catalogOffset <= 0) {
    errors.push("root-offsets");
  } else {
    const pagesEnd = nextOffset(offsets, pagesOffset, xrefOffset);
    const pagesObject = await blob.slice(pagesOffset, pagesEnd).text();
    if (!pagesObject.startsWith("2 0 obj") || !pagesObject.includes("/Type /Pages")) {
      errors.push("pages-root");
    }
    if (!pagesObject.includes(`/Count ${expectedPageCount}`)) errors.push("page-count");
    const kidsMatch = /\/Kids \[([^\]]*)\]/u.exec(pagesObject)?.[1] ?? "";
    const kidRefs = [...kidsMatch.matchAll(/(\d+) 0 R/gu)].map((match) => Number.parseInt(match[1] ?? "-1", 10));
    const expectedKids = Array.from({ length: expectedPageCount }, (_, index) => pageObjectNumber(index));
    if (
      kidRefs.length !== expectedKids.length ||
      kidRefs.some((objectNumber, index) => objectNumber !== expectedKids[index])
    ) {
      errors.push("page-kids");
    }

    const catalogEnd = nextOffset(offsets, catalogOffset, xrefOffset);
    const catalogObject = await blob.slice(catalogOffset, catalogEnd).text();
    if (
      !catalogObject.startsWith("1 0 obj") ||
      !catalogObject.includes("/Type /Catalog") ||
      !catalogObject.includes("/Pages 2 0 R")
    ) {
      errors.push("catalog");
    }
  }

  return {
    valid: errors.length === 0,
    pageCount: errors.includes("page-count") || errors.includes("page-kids") ? 0 : expectedPageCount,
    objectCount: expectedSize - 1,
    byteLength: blob.size,
    xrefOffset,
    errors,
  };
}

export async function assertStreamingPdfStructure(
  blob: Blob,
  expectedPageCount: number,
): Promise<StreamingPdfIntegrityReport> {
  const report = await inspectStreamingPdfStructure(blob, expectedPageCount);
  if (!report.valid) {
    throw integrityError(
      `The streamed PDF failed structural validation: ${report.errors.join(",")}.`,
      "StreamingPdfIntegrityCheckFailed",
    );
  }
  return report;
}
