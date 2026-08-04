import { describe, expect, it } from "vitest";

import {
  PdfExporter,
  type PdfDocumentPort,
  type PdfExportEnvironment,
  type PdfIntegrityInspector,
} from "@offscreen/pdf-exporter";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile } from "@shared/contracts/domain";
import type { PdfEditorPage } from "@shared/contracts/pdf-editor";
import type { StoredTileRecord } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

function input(): {
  tile: CaptureTile;
  record: StoredTileRecord;
  pages: PdfEditorPage[];
} {
  const tile: CaptureTile = {
    id: "job-1:0",
    jobId: "job-1",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 0, y: 0, width: 100, height: 300 },
    outputRectCss: { x: 0, y: 0, width: 100, height: 300 },
    expectedPixelWidth: 100,
    expectedPixelHeight: 300,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    overlapRightCss: 0,
    overlapBottomCss: 0,
    status: "stored",
    attempts: 1,
    byteLength: 3,
    mimeType: "image/png",
  };
  const page = (id: string, originalIndex: number, y: number): PdfEditorPage => ({
    id,
    originalIndex,
    sourceRectCss: { x: 0, y, width: 100, height: 100 },
    pageWidthPt: originalIndex === 2 ? 700 : 600,
    pageHeightPt: 800,
    imageRectPt: { x: 20, y: 20, width: 560, height: 760 },
  });
  return {
    tile,
    record: {
      schemaVersion: 1,
      jobId: tile.jobId,
      index: tile.index,
      tile,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      createdAt: "2026-08-03T13:00:00.000Z",
      updatedAt: "2026-08-03T13:00:00.000Z",
    },
    pages: [page("page-3", 2, 200), page("page-1", 0, 0)],
  };
}

function repositories(record: StoredTileRecord): {
  tiles: TileRepositoryPort;
  artifacts: ArtifactRepositoryPort;
  stored: () => ArtifactRecord | undefined;
} {
  let artifact: ArtifactRecord | undefined;
  return {
    tiles: {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(record),
      listByJob: () => Promise.resolve([record]),
      deleteByJob: () => Promise.resolve(0),
    },
    artifacts: {
      put: (next) => {
        artifact = next;
        return Promise.resolve();
      },
      get: () => Promise.resolve(artifact),
      delete: () => Promise.resolve(false),
      deleteExpired: () => Promise.resolve(0),
    },
    stored: () => artifact,
  };
}

function environment(pageWidths: number[], released: { count: number }): PdfExportEnvironment {
  return {
    decode: () =>
      Promise.resolve({
        width: 100,
        height: 300,
        source: {} as CanvasImageSource,
        close: () => undefined,
      }),
    createCanvas: (width, height) => ({
      width,
      height,
      getContext: () => ({ fillWhite: () => undefined, drawImage: () => undefined }),
      convertToJpeg: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: "image/jpeg" })),
      release() {
        released.count += 1;
      },
    }),
    createDocument: () =>
      Promise.resolve({
        addJpegPage(options) {
          pageWidths.push(options.pageWidthPt);
          return Promise.resolve();
        },
        save: () => Promise.resolve(new Uint8Array([37, 80, 68, 70, 45])),
      } satisfies PdfDocumentPort),
  };
}

const acceptTestPdf: PdfIntegrityInspector = (input, expectations = {}) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const pages = (expectations.pageSizes ?? []).map((page, index) => ({
    index,
    widthPt: page.widthPt,
    heightPt: page.heightPt,
  }));
  return Promise.resolve({
    valid: true,
    byteLength: bytes.byteLength,
    signatureValid: true,
    pageCount: expectations.pageCount ?? pages.length,
    pages,
    imageObjectCount: 1,
    nonEmptyStreamCount: 1,
    errors: [],
  });
};

describe("edited PdfExporter pages", () => {
  it("exports only the selected pages in manifest order", async () => {
    const source = input();
    const repository = repositories(source.record);
    const pageWidths: number[] = [];
    const released = { count: 0 };
    const exporter = new PdfExporter({
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment: environment(pageWidths, released),
      inspectIntegrity: acceptTestPdf,
    });

    const result = await exporter.export({
      jobId: "job-1",
      outputArtifactId: "pdf-edited",
      targetRect: { x: 0, y: 0, width: 100, height: 300 },
      tiles: [source.tile],
      settings: DEFAULT_CAPTURE_SETTINGS.pdf,
      pages: source.pages,
      filename: "edited.pdf",
      createdAt: "2026-08-03T13:30:00.000Z",
      expiresAt: "2026-08-03T14:00:00.000Z",
    });

    expect(pageWidths).toEqual([700, 600]);
    expect(released.count).toBe(2);
    expect(result.artifact.pageCount).toBe(2);
    expect(result.diagnostics.integrity).toMatchObject({ valid: true, pageCount: 2 });
    expect(repository.stored()).toMatchObject({
      artifactId: "pdf-edited",
      pageCount: 2,
    });
  });

  it("stops between pages when progress acknowledgement rejects and persists no PDF", async () => {
    const source = input();
    const repository = repositories(source.record);
    const pageWidths: number[] = [];
    const released = { count: 0 };
    const exporter = new PdfExporter({
      tiles: repository.tiles,
      artifacts: repository.artifacts,
      environment: environment(pageWidths, released),
      inspectIntegrity: acceptTestPdf,
    });

    await expect(
      exporter.export(
        {
          jobId: "job-1",
          outputArtifactId: "pdf-cancelled",
          targetRect: { x: 0, y: 0, width: 100, height: 300 },
          tiles: [source.tile],
          settings: DEFAULT_CAPTURE_SETTINGS.pdf,
          pages: source.pages,
          filename: "cancelled.pdf",
          createdAt: "2026-08-03T13:30:00.000Z",
          expiresAt: "2026-08-03T14:00:00.000Z",
        },
        () => Promise.resolve(false),
      ),
    ).rejects.toMatchObject({ name: "E_CANCELLED" });

    expect(pageWidths).toEqual([700]);
    expect(released.count).toBe(1);
    expect(repository.stored()).toBeUndefined();
  });
});
