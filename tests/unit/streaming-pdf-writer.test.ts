import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  assertStreamingPdfStructure,
  inspectStreamingPdfStructure,
} from "@offscreen/streaming-pdf-integrity";
import { SequentialRasterPdfWriter } from "@offscreen/streaming-pdf-writer";
import type { PdfSpoolFile, PdfSpoolWritable } from "@storage/pdf-output-spool";

const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

class MemoryPdfWritable implements PdfSpoolWritable {
  readonly reference = "webcap-pdf-output/test.pdf";
  private readonly chunks: ArrayBuffer[] = [];
  private bytes = 0;
  private closed = false;

  get byteLength(): number {
    return this.bytes;
  }

  write(chunk: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error("closed"));
    const copy = Uint8Array.from(chunk).buffer;
    this.chunks.push(copy);
    this.bytes += copy.byteLength;
    return Promise.resolve();
  }

  close(): Promise<PdfSpoolFile> {
    this.closed = true;
    const blob = new Blob(this.chunks, { type: "application/pdf" });
    return Promise.resolve({
      reference: this.reference,
      byteLength: blob.size,
      mimeType: "application/pdf",
      blob,
    });
  }

  abort(): Promise<void> {
    this.closed = true;
    this.chunks.length = 0;
    this.bytes = 0;
    return Promise.resolve();
  }
}

function jpegBlob(): Blob {
  return new Blob([Uint8Array.from(ONE_PIXEL_JPEG).buffer], { type: "image/jpeg" });
}

async function writeDocument(pageCount: number): Promise<Blob> {
  const output = new MemoryPdfWritable();
  const writer = new SequentialRasterPdfWriter(output, pageCount);
  const jpeg = jpegBlob();
  for (let index = 0; index < pageCount; index += 1) {
    const landscape = index % 2 === 1;
    const pageWidthPt = landscape ? 842 : 595;
    const pageHeightPt = landscape ? 595 : 842;
    const checkpoint = await writer.addJpegPage({
      jpeg,
      pixelWidth: 1,
      pixelHeight: 1,
      pageWidthPt,
      pageHeightPt,
      imageRectPt: { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt },
    });
    expect(checkpoint.pagesWritten).toBe(index + 1);
    expect(checkpoint.byteLength).toBeGreaterThan(0);
  }
  const finalized = await writer.finalize();
  expect(finalized.pageCount).toBe(pageCount);
  expect(finalized.checkpoint.pagesWritten).toBe(pageCount);
  expect(finalized.checkpoint.byteLength).toBe(finalized.file.byteLength);
  return finalized.file.blob;
}

describe("SequentialRasterPdfWriter", () => {
  it("writes a loadable mixed-orientation PDF sequentially", async () => {
    const blob = await writeDocument(3);
    const integrity = await assertStreamingPdfStructure(blob, 3);
    expect(integrity).toMatchObject({ valid: true, pageCount: 3, objectCount: 11 });

    const loaded = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(loaded.getPageCount()).toBe(3);
    const sizes = loaded.getPages().map((page) => page.getSize());
    expect(sizes).toEqual([
      { width: 595, height: 842 },
      { width: 842, height: 595 },
      { width: 595, height: 842 },
    ]);
  });

  it.each([126, 500, 2_000])(
    "keeps the exact logical page count for a %i-page streamed output",
    async (pageCount) => {
      const blob = await writeDocument(pageCount);
      const integrity = await inspectStreamingPdfStructure(blob, pageCount);
      expect(integrity.valid).toBe(true);
      expect(integrity.pageCount).toBe(pageCount);
      expect(integrity.objectCount).toBe(pageCount * 3 + 2);
      expect(integrity.byteLength).toBe(blob.size);
    },
    20_000,
  );

  it("refuses to finalize a truncated page sequence", async () => {
    const output = new MemoryPdfWritable();
    const writer = new SequentialRasterPdfWriter(output, 2);
    await writer.addJpegPage({
      jpeg: jpegBlob(),
      pixelWidth: 1,
      pixelHeight: 1,
      pageWidthPt: 595,
      pageHeightPt: 842,
      imageRectPt: { x: 0, y: 0, width: 595, height: 842 },
    });
    await expect(writer.finalize()).rejects.toMatchObject({ name: "E_EXPORT_FAILED" });
  });
});
