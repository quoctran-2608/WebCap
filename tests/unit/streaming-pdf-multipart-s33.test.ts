import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { StreamingPdfExporter } from "@offscreen/streaming-pdf-exporter";
import type { PdfPageCanvasPort } from "@offscreen/pdf-exporter";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { PdfOutputSpoolPort, PdfSpoolFile, PdfSpoolWritable } from "@storage/pdf-output-spool";
import type {
  PdfWriterCheckpoint,
  PdfWriterCheckpointRepositoryPort,
} from "@storage/pdf-writer-checkpoint-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

class MemorySpool implements PdfOutputSpoolPort {
  readonly files = new Map<string, Blob>();

  availableBytes(): Promise<number | undefined> {
    return Promise.resolve(1_000_000_000);
  }

  createOutput(outputArtifactId: string): Promise<PdfSpoolWritable> {
    const reference = `webcap-pdf-output/${outputArtifactId}.pdf`;
    const chunks: ArrayBuffer[] = [];
    let byteLength = 0;
    let closed = false;
    return Promise.resolve({
      reference,
      get byteLength() {
        return byteLength;
      },
      write: (chunk) => {
        if (closed) return Promise.reject(new Error("closed"));
        const copy = Uint8Array.from(chunk).buffer;
        chunks.push(copy);
        byteLength += copy.byteLength;
        return Promise.resolve();
      },
      commit: () => Promise.resolve(),
      close: () => {
        closed = true;
        const blob = new Blob(chunks, { type: "application/pdf" });
        this.files.set(reference, blob);
        return Promise.resolve({
          reference,
          byteLength: blob.size,
          mimeType: "application/pdf",
          blob,
        });
      },
      abort: () => {
        closed = true;
        this.files.delete(reference);
        return Promise.resolve();
      },
    });
  }

  writeRasterPage(outputArtifactId: string, pageIndex: number, blob: Blob): Promise<PdfSpoolFile> {
    const reference = `webcap-pdf-output/${outputArtifactId}.page-${pageIndex}.jpg`;
    const owned = blob.slice(0, blob.size, "image/jpeg");
    this.files.set(reference, owned);
    return Promise.resolve({
      reference,
      byteLength: owned.size,
      mimeType: "image/jpeg",
      blob: owned,
    });
  }

  read(reference: string): Promise<Blob> {
    const blob = this.files.get(reference);
    return blob === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(blob);
  }

  delete(reference: string): Promise<void> {
    this.files.delete(reference);
    return Promise.resolve();
  }
}

function checkpointRepository(): PdfWriterCheckpointRepositoryPort {
  let checkpoint: PdfWriterCheckpoint | undefined;
  return {
    get: () => Promise.resolve(checkpoint),
    put: (next) => {
      checkpoint = next;
      return Promise.resolve();
    },
    delete: () => {
      const existed = checkpoint !== undefined;
      checkpoint = undefined;
      return Promise.resolve(existed);
    },
  };
}

function source(): { tile: CaptureTile; record: StoredTileRecord } {
  const tile: CaptureTile = {
    id: "job-multipart:0",
    jobId: "job-multipart",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 0, y: 0, width: 1, height: 3 },
    outputRectCss: { x: 0, y: 0, width: 1, height: 3 },
    captureViewportCss: { x: 0, y: 0, width: 1, height: 3 },
    expectedPixelWidth: 1,
    expectedPixelHeight: 3,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    overlapRightCss: 0,
    overlapBottomCss: 0,
    status: "stored",
    attempts: 1,
    byteLength: 3,
    mimeType: "image/png",
  };
  return {
    tile,
    record: {
      schemaVersion: 1,
      jobId: tile.jobId,
      index: 0,
      tile,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      createdAt: "2026-08-08T03:00:00.000Z",
      updatedAt: "2026-08-08T03:00:00.000Z",
    },
  };
}

function logicalPages() {
  return [0, 1, 2].map((index) => ({
    id: `page-${index + 1}`,
    originalIndex: index,
    sourceRectCss: { x: 0, y: index, width: 1, height: 1 },
    pageWidthPt: index === 1 ? 842 : 595,
    pageHeightPt: index === 1 ? 595 : 842,
    imageRectPt: {
      x: 0,
      y: 0,
      width: index === 1 ? 842 : 595,
      height: index === 1 ? 595 : 842,
    },
  }));
}

describe("S33 streamed PDF multipart output", () => {
  it("writes loadable page-aligned parts with exact ranges and no gap or duplicate", async () => {
    const sourceData = source();
    const artifacts = new Map<string, ArtifactRecord>();
    const artifactRepository: ArtifactRepositoryPort = {
      put: (artifact) => {
        artifacts.set(artifact.artifactId, artifact);
        return Promise.resolve();
      },
      get: (artifactId) => Promise.resolve(artifacts.get(artifactId)),
      delete: (artifactId) => Promise.resolve(artifacts.delete(artifactId)),
      deleteExpired: () => Promise.resolve(0),
    };
    const tileRepository: TileRepositoryPort = {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(sourceData.record),
      listByJob: () => Promise.resolve([sourceData.record]),
      deleteByJob: () => Promise.resolve(0),
    };
    const spool = new MemorySpool();
    const progress: number[] = [];
    const exporter = new StreamingPdfExporter({
      tiles: tileRepository,
      artifacts: artifactRepository,
      spool,
      checkpoints: checkpointRepository(),
      maxPartBytes: 80_000,
      fallback: { export: () => Promise.reject(new Error("fallback must not run")) },
      environment: {
        decode: () =>
          Promise.resolve({
            width: 1,
            height: 3,
            source: {} as CanvasImageSource,
            close: () => undefined,
          }),
        createCanvas(width, height): PdfPageCanvasPort {
          return {
            width,
            height,
            getContext: () => ({ fillWhite: () => undefined, drawImage: () => undefined }),
            convertToJpeg: () =>
              Promise.resolve(
                new Blob([Uint8Array.from(ONE_PIXEL_JPEG).buffer], { type: "image/jpeg" }),
              ),
            release: () => undefined,
          };
        },
      },
    });

    const result = await exporter.export(
      {
        jobId: "job-multipart",
        outputArtifactId: "multipart-pdf",
        targetRect: { x: 0, y: 0, width: 1, height: 3 },
        tiles: [sourceData.tile],
        pages: logicalPages(),
        settings: DEFAULT_CAPTURE_SETTINGS.pdf,
        filename: "capture.pdf",
        createdAt: "2026-08-08T03:00:00.000Z",
        expiresAt: "2026-08-08T03:30:00.000Z",
      },
      ({ completedPages }) => {
        progress.push(completedPages);
        return Promise.resolve(true);
      },
    );

    expect(progress).toEqual([1, 2, 3]);
    expect(result.diagnostics.pageCount).toBe(3);
    const parts = [...artifacts.values()].sort(
      (left, right) => (left.pdfPart?.partIndex ?? -1) - (right.pdfPart?.partIndex ?? -1),
    );
    expect(parts).toHaveLength(3);
    expect(parts.map((part) => part.pageCount)).toEqual([1, 1, 1]);
    expect(parts.map((part) => part.pdfPart)).toEqual([
      {
        schemaVersion: 1,
        groupId: "multipart-pdf",
        partIndex: 0,
        partCount: 3,
        startPageIndex: 0,
        endPageIndexExclusive: 1,
        documentPageCount: 3,
      },
      {
        schemaVersion: 1,
        groupId: "multipart-pdf",
        partIndex: 1,
        partCount: 3,
        startPageIndex: 1,
        endPageIndexExclusive: 2,
        documentPageCount: 3,
      },
      {
        schemaVersion: 1,
        groupId: "multipart-pdf",
        partIndex: 2,
        partCount: 3,
        startPageIndex: 2,
        endPageIndexExclusive: 3,
        documentPageCount: 3,
      },
    ]);
    expect(parts.map((part) => part.filename)).toEqual([
      "capture.part-001-pages-0001-0001.pdf",
      "capture.part-002-pages-0002-0002.pdf",
      "capture.part-003-pages-0003-0003.pdf",
    ]);

    const sizes: Array<{ width: number; height: number }> = [];
    for (const part of parts) {
      expect(part.opfsReference).toBeDefined();
      const blob = await spool.read(part.opfsReference!);
      expect(String.fromCharCode(...new Uint8Array(await blob.slice(0, 5).arrayBuffer()))).toBe(
        "%PDF-",
      );
      const document = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
      expect(document.getPageCount()).toBe(1);
      sizes.push(document.getPage(0).getSize());
    }
    expect(sizes).toEqual([
      { width: 595, height: 842 },
      { width: 842, height: 595 },
      { width: 595, height: 842 },
    ]);
  });
});
