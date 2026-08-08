import type { Rect } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { PdfSpoolFile, PdfSpoolWritable } from "@storage/pdf-output-spool";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_PDF_XREF_OFFSET = 9_999_999_999;
const PDF_HEADER_BYTES = 15;

export interface StreamingPdfWriterCheckpoint {
  spoolReference: string;
  pagesWritten: number;
  totalPages: number;
  byteLength: number;
}

export interface StreamingPdfWriterResumeState {
  pagesWritten: number;
  totalPages: number;
  byteLength: number;
  offsets: number[];
}

export interface StreamingPdfPageInput {
  jpeg: Blob;
  pixelWidth: number;
  pixelHeight: number;
  pageWidthPt: number;
  pageHeightPt: number;
  imageRectPt: Rect;
}

export interface StreamingPdfWriterResult {
  file: PdfSpoolFile;
  pageCount: number;
  checkpoint: StreamingPdfWriterCheckpoint;
}

function writerError(
  message: string,
  causeCode: string,
  safeContext?: Record<string, number | string>,
): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message,
      userMessageKey: "errors.exportFailed",
      retryable: true,
      fallbackAllowed: false,
      causeCode,
      ...(safeContext === undefined ? {} : { safeContext }),
    }),
  );
}

function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw writerError(
      "The streamed PDF contains an invalid numeric value.",
      "StreamingPdfInvalidNumber",
    );
  }
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function pageObjectNumber(pageIndex: number): number {
  return 3 + pageIndex * 3;
}

function imageObjectNumber(pageIndex: number): number {
  return 4 + pageIndex * 3;
}

function contentObjectNumber(pageIndex: number): number {
  return 5 + pageIndex * 3;
}

function expectedObjectSize(totalPages: number): number {
  return 3 + totalPages * 3;
}

async function readAscii(blob: Blob, offset: number, maximum: number): Promise<string> {
  return decoder.decode(
    await blob.slice(offset, Math.min(blob.size, offset + maximum)).arrayBuffer(),
  );
}

async function expectAscii(blob: Blob, offset: number, expected: string): Promise<void> {
  const actual = await readAscii(blob, offset, expected.length);
  if (actual !== expected) {
    throw writerError(
      "The durable streamed PDF checkpoint does not match the expected object sequence.",
      "StreamingPdfResumeStructureMismatch",
      { offset },
    );
  }
}

function streamLength(header: string): number {
  const match = /\/Length\s+(\d+)/u.exec(header);
  const value = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw writerError(
      "The durable streamed PDF checkpoint contains an invalid stream length.",
      "StreamingPdfResumeLengthInvalid",
    );
  }
  return value;
}

export async function recoverStreamingPdfWriterState(
  blob: Blob,
  pagesWritten: number,
  totalPages: number,
): Promise<StreamingPdfWriterResumeState> {
  if (
    !Number.isInteger(pagesWritten) ||
    pagesWritten < 0 ||
    !Number.isInteger(totalPages) ||
    totalPages <= 0 ||
    pagesWritten > totalPages
  ) {
    throw writerError(
      "The streamed PDF recovery checkpoint has an invalid page count.",
      "StreamingPdfResumePageCountInvalid",
    );
  }
  if (pagesWritten === 0) {
    return {
      pagesWritten: 0,
      totalPages,
      byteLength: 0,
      offsets: new Array<number>(expectedObjectSize(totalPages))
        .fill(-1)
        .map((value, index) => (index === 0 ? 0 : value)),
    };
  }
  if (blob.size < PDF_HEADER_BYTES) {
    throw writerError(
      "The durable streamed PDF checkpoint is shorter than its PDF header.",
      "StreamingPdfResumeTruncated",
    );
  }
  await expectAscii(blob, 0, "%PDF-1.7\n");
  const offsets = new Array<number>(expectedObjectSize(totalPages)).fill(-1);
  offsets[0] = 0;
  let offset = PDF_HEADER_BYTES;

  for (let pageIndex = 0; pageIndex < pagesWritten; pageIndex += 1) {
    const pageObject = pageObjectNumber(pageIndex);
    const imageObject = imageObjectNumber(pageIndex);
    const contentObject = contentObjectNumber(pageIndex);

    offsets[pageObject] = offset;
    await expectAscii(blob, offset, `${pageObject} 0 obj\n`);
    const pageText = await readAscii(blob, offset, 2_048);
    const pageEnd = pageText.indexOf("endobj\n");
    if (pageEnd < 0) {
      throw writerError(
        "The durable streamed PDF page object is incomplete.",
        "StreamingPdfResumePageObjectIncomplete",
        { pageIndex },
      );
    }
    offset += pageEnd + "endobj\n".length;

    offsets[imageObject] = offset;
    await expectAscii(blob, offset, `${imageObject} 0 obj\n`);
    const imageHeader = await readAscii(blob, offset, 2_048);
    const imageStream = imageHeader.indexOf("stream\n");
    if (imageStream < 0) {
      throw writerError(
        "The durable streamed PDF image object is incomplete.",
        "StreamingPdfResumeImageHeaderIncomplete",
        { pageIndex },
      );
    }
    const imageLength = streamLength(imageHeader.slice(0, imageStream));
    offset += imageStream + "stream\n".length + imageLength;
    const imageTail = "\nendstream\nendobj\n";
    await expectAscii(blob, offset, imageTail);
    offset += imageTail.length;

    offsets[contentObject] = offset;
    await expectAscii(blob, offset, `${contentObject} 0 obj\n`);
    const contentHeader = await readAscii(blob, offset, 1_024);
    const contentStream = contentHeader.indexOf("stream\n");
    if (contentStream < 0) {
      throw writerError(
        "The durable streamed PDF content object is incomplete.",
        "StreamingPdfResumeContentHeaderIncomplete",
        { pageIndex },
      );
    }
    const contentLength = streamLength(contentHeader.slice(0, contentStream));
    offset += contentStream + "stream\n".length + contentLength;
    const contentTail = "endstream\nendobj\n";
    await expectAscii(blob, offset, contentTail);
    offset += contentTail.length;
  }

  if (offset !== blob.size) {
    throw writerError(
      "The durable streamed PDF checkpoint contains bytes beyond the verified page boundary.",
      "StreamingPdfResumeBoundaryMismatch",
      { verifiedBytes: offset, checkpointBytes: blob.size },
    );
  }
  return { pagesWritten, totalPages, byteLength: blob.size, offsets };
}

export class SequentialRasterPdfWriter {
  private readonly output: PdfSpoolWritable;
  private readonly totalPages: number;
  private readonly offsets: number[];
  private initialized = false;
  private finalized = false;
  private pagesWritten = 0;

  constructor(
    output: PdfSpoolWritable,
    totalPages: number,
    resume?: StreamingPdfWriterResumeState,
  ) {
    if (!Number.isInteger(totalPages) || totalPages <= 0) {
      throw writerError(
        "Streamed PDF output requires a positive page count.",
        "StreamingPdfPageCountInvalid",
      );
    }
    this.output = output;
    this.totalPages = totalPages;
    this.offsets = new Array<number>(expectedObjectSize(totalPages)).fill(-1);
    this.offsets[0] = 0;
    if (resume !== undefined) {
      if (
        resume.totalPages !== totalPages ||
        resume.byteLength !== output.byteLength ||
        resume.offsets.length !== this.offsets.length
      ) {
        throw writerError(
          "The streamed PDF writer resume state does not match the output checkpoint.",
          "StreamingPdfResumeStateMismatch",
        );
      }
      this.pagesWritten = resume.pagesWritten;
      this.initialized = resume.pagesWritten > 0;
      for (let index = 0; index < resume.offsets.length; index += 1) {
        this.offsets[index] = resume.offsets[index] ?? -1;
      }
    }
  }

  get checkpoint(): StreamingPdfWriterCheckpoint {
    return {
      spoolReference: this.output.reference,
      pagesWritten: this.pagesWritten,
      totalPages: this.totalPages,
      byteLength: this.output.byteLength,
    };
  }

  private async writeBytes(bytes: Uint8Array): Promise<void> {
    await this.output.write(bytes);
  }

  private async writeText(text: string): Promise<void> {
    await this.writeBytes(encoder.encode(text));
  }

  private recordOffset(objectNumber: number): void {
    const offset = this.output.byteLength;
    if (offset > MAX_PDF_XREF_OFFSET) {
      throw writerError(
        "The streamed PDF exceeded the supported xref offset range.",
        "StreamingPdfXrefOverflow",
        { byteLength: offset },
      );
    }
    this.offsets[objectNumber] = offset;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.writeBytes(
      new Uint8Array([
        0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
      ]),
    );
    this.initialized = true;
  }

  private async writeBlob(blob: Blob): Promise<void> {
    const reader = blob.stream().getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (result.value.byteLength > 0) await this.writeBytes(result.value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  async addJpegPage(page: StreamingPdfPageInput): Promise<StreamingPdfWriterCheckpoint> {
    if (this.finalized) {
      throw writerError(
        "The streamed PDF writer is already finalized.",
        "StreamingPdfWriterFinalized",
      );
    }
    if (this.pagesWritten >= this.totalPages) {
      throw writerError(
        "The streamed PDF writer received more pages than planned.",
        "StreamingPdfTooManyPages",
      );
    }
    if (
      !Number.isInteger(page.pixelWidth) ||
      !Number.isInteger(page.pixelHeight) ||
      page.pixelWidth <= 0 ||
      page.pixelHeight <= 0 ||
      page.jpeg.size <= 0 ||
      page.pageWidthPt <= 0 ||
      page.pageHeightPt <= 0 ||
      page.imageRectPt.width <= 0 ||
      page.imageRectPt.height <= 0
    ) {
      throw writerError(
        "A streamed PDF page has invalid raster or geometry metadata.",
        "StreamingPdfPageInvalid",
        { pageIndex: this.pagesWritten },
      );
    }

    await this.initialize();
    const pageIndex = this.pagesWritten;
    const pageObject = pageObjectNumber(pageIndex);
    const imageObject = imageObjectNumber(pageIndex);
    const contentObject = contentObjectNumber(pageIndex);

    this.recordOffset(pageObject);
    await this.writeText(
      `${pageObject} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(page.pageWidthPt)} ${pdfNumber(page.pageHeightPt)}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`,
    );

    this.recordOffset(imageObject);
    await this.writeText(
      `${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.size} >>\nstream\n`,
    );
    await this.writeBlob(page.jpeg);
    await this.writeText("\nendstream\nendobj\n");

    const content = `q\n${pdfNumber(page.imageRectPt.width)} 0 0 ${pdfNumber(page.imageRectPt.height)} ${pdfNumber(page.imageRectPt.x)} ${pdfNumber(page.imageRectPt.y)} cm\n/Im0 Do\nQ\n`;
    const contentBytes = encoder.encode(content);
    this.recordOffset(contentObject);
    await this.writeText(
      `${contentObject} 0 obj\n<< /Length ${contentBytes.byteLength} >>\nstream\n`,
    );
    await this.writeBytes(contentBytes);
    await this.writeText("endstream\nendobj\n");

    this.pagesWritten += 1;
    return this.checkpoint;
  }

  async commit(): Promise<StreamingPdfWriterCheckpoint> {
    if (this.finalized) {
      throw writerError(
        "The streamed PDF writer is already finalized.",
        "StreamingPdfWriterFinalized",
      );
    }
    await this.output.commit?.();
    return this.checkpoint;
  }

  async finalize(): Promise<StreamingPdfWriterResult> {
    if (this.finalized) {
      throw writerError(
        "The streamed PDF writer was finalized more than once.",
        "StreamingPdfWriterFinalized",
      );
    }
    if (this.pagesWritten !== this.totalPages) {
      throw writerError(
        "The streamed PDF writer cannot finalize before every planned page is written.",
        "StreamingPdfPagesIncomplete",
        { pagesWritten: this.pagesWritten, totalPages: this.totalPages },
      );
    }
    await this.initialize();

    this.recordOffset(2);
    const kids = Array.from(
      { length: this.totalPages },
      (_, index) => `${pageObjectNumber(index)} 0 R`,
    ).join(" ");
    await this.writeText(
      `2 0 obj\n<< /Type /Pages /Count ${this.totalPages} /Kids [${kids}] >>\nendobj\n`,
    );

    this.recordOffset(1);
    await this.writeText("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    const xrefOffset = this.output.byteLength;
    const size = this.offsets.length;
    await this.writeText(`xref\n0 ${size}\n`);
    await this.writeText("0000000000 65535 f \n");
    for (let objectNumber = 1; objectNumber < size; objectNumber += 1) {
      const offset = this.offsets[objectNumber];
      if (offset === undefined || offset < 0 || offset > MAX_PDF_XREF_OFFSET) {
        throw writerError(
          "The streamed PDF xref table is incomplete.",
          "StreamingPdfXrefIncomplete",
          { objectNumber },
        );
      }
      await this.writeText(`${Math.floor(offset).toString().padStart(10, "0")} 00000 n \n`);
    }
    await this.writeText(
      `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );

    const file = await this.output.close();
    this.finalized = true;
    return {
      file,
      pageCount: this.pagesWritten,
      checkpoint: {
        spoolReference: file.reference,
        pagesWritten: this.pagesWritten,
        totalPages: this.totalPages,
        byteLength: file.byteLength,
      },
    };
  }

  async suspend(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    if (this.output.rollback !== undefined) {
      await this.output.rollback();
      return;
    }
    await this.output.close().then(() => undefined);
  }

  async abort(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    await this.output.abort();
  }
}
