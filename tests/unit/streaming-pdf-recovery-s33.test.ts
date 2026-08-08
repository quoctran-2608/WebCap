import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  SequentialRasterPdfWriter,
  recoverStreamingPdfWriterState,
} from "@offscreen/streaming-pdf-writer";
import type { PdfSpoolFile, PdfSpoolWritable } from "@storage/pdf-output-spool";

const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

interface MemoryFileState {
  durable: Uint8Array;
}

class DurableMemoryWritable implements PdfSpoolWritable {
  readonly reference = "webcap-pdf-output/recovery.pdf";
  private working: Uint8Array;
  private closed = false;

  constructor(
    private readonly state: MemoryFileState,
    byteLength = state.durable.byteLength,
  ) {
    this.working = state.durable.slice(0, byteLength);
  }

  get byteLength(): number {
    return this.working.byteLength;
  }

  write(chunk: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error("closed"));
    const next = new Uint8Array(this.working.byteLength + chunk.byteLength);
    next.set(this.working);
    next.set(chunk, this.working.byteLength);
    this.working = next;
    return Promise.resolve();
  }

  commit(): Promise<void> {
    this.state.durable = this.working.slice();
    return Promise.resolve();
  }

  rollback(): Promise<void> {
    this.closed = true;
    this.working = this.state.durable.slice();
    return Promise.resolve();
  }

  close(): Promise<PdfSpoolFile> {
    this.state.durable = this.working.slice();
    this.closed = true;
    const blob = new Blob([this.state.durable.slice().buffer], { type: "application/pdf" });
    return Promise.resolve({
      reference: this.reference,
      byteLength: blob.size,
      mimeType: "application/pdf",
      blob,
    });
  }

  abort(): Promise<void> {
    this.closed = true;
    this.state.durable = new Uint8Array();
    this.working = new Uint8Array();
    return Promise.resolve();
  }
}

function jpegBlob(): Blob {
  return new Blob([Uint8Array.from(ONE_PIXEL_JPEG).buffer], { type: "image/jpeg" });
}

async function addPage(writer: SequentialRasterPdfWriter, pageIndex: number): Promise<void> {
  const landscape = pageIndex % 2 === 1;
  const width = landscape ? 842 : 595;
  const height = landscape ? 595 : 842;
  await writer.addJpegPage({
    jpeg: jpegBlob(),
    pixelWidth: 1,
    pixelHeight: 1,
    pageWidthPt: width,
    pageHeightPt: height,
    imageRectPt: { x: 0, y: 0, width, height },
  });
}

describe("S33 streamed PDF writer recovery", () => {
  it("resumes from the last durable page without duplicate or missing pages", async () => {
    const state: MemoryFileState = { durable: new Uint8Array() };
    const first = new SequentialRasterPdfWriter(new DurableMemoryWritable(state), 3);
    await addPage(first, 0);
    const firstCheckpoint = await first.commit();
    await addPage(first, 1);
    const secondCheckpoint = await first.commit();
    expect(secondCheckpoint.pagesWritten).toBe(2);
    expect(state.durable.byteLength).toBe(secondCheckpoint.byteLength);
    await first.suspend();

    const durableBlob = new Blob([state.durable.slice().buffer], { type: "application/pdf" });
    const resume = await recoverStreamingPdfWriterState(durableBlob, 2, 3);
    expect(resume.byteLength).toBe(secondCheckpoint.byteLength);
    expect(resume.offsets.filter((offset) => offset >= 0)).toHaveLength(7);

    const resumed = new SequentialRasterPdfWriter(
      new DurableMemoryWritable(state, secondCheckpoint.byteLength),
      3,
      resume,
    );
    await addPage(resumed, 2);
    await resumed.commit();
    const finalized = await resumed.finalize();
    const loaded = await PDFDocument.load(new Uint8Array(await finalized.file.blob.arrayBuffer()));
    expect(loaded.getPageCount()).toBe(3);
    expect(loaded.getPages().map((page) => page.getSize())).toEqual([
      { width: 595, height: 842 },
      { width: 842, height: 595 },
      { width: 595, height: 842 },
    ]);
    expect(firstCheckpoint.byteLength).toBeLessThan(secondCheckpoint.byteLength);
  });

  it("ignores an uncheckpointed page suffix after a simulated crash", async () => {
    const state: MemoryFileState = { durable: new Uint8Array() };
    const writer = new SequentialRasterPdfWriter(new DurableMemoryWritable(state), 3);
    await addPage(writer, 0);
    const checkpoint = await writer.commit();
    await addPage(writer, 1);
    await writer.suspend();

    expect(state.durable.byteLength).toBe(checkpoint.byteLength);
    const durableBlob = new Blob([state.durable.slice().buffer], { type: "application/pdf" });
    const resume = await recoverStreamingPdfWriterState(durableBlob, 1, 3);
    const resumed = new SequentialRasterPdfWriter(
      new DurableMemoryWritable(state, checkpoint.byteLength),
      3,
      resume,
    );
    await addPage(resumed, 1);
    await resumed.commit();
    await addPage(resumed, 2);
    await resumed.commit();
    const finalized = await resumed.finalize();
    const loaded = await PDFDocument.load(new Uint8Array(await finalized.file.blob.arrayBuffer()));
    expect(loaded.getPageCount()).toBe(3);
  });
});
