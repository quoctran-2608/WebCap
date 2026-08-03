import { describe, expect, it } from "vitest";

import { createPdfPageThumbnail, type ThumbnailEnvironment } from "@editor/thumbnail-service";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile } from "@shared/contracts/domain";
import type { PdfEditorPage } from "@shared/contracts/pdf-editor";
import type { StoredTileRecord } from "@shared/contracts/job";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

function source(): { tile: CaptureTile; record: StoredTileRecord; page: PdfEditorPage } {
  const tile: CaptureTile = {
    id: "job-1:0",
    jobId: "job-1",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 0, y: 0, width: 800, height: 1_200 },
    outputRectCss: { x: 0, y: 0, width: 800, height: 1_200 },
    expectedPixelWidth: 800,
    expectedPixelHeight: 1_200,
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
      index: tile.index,
      tile,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      createdAt: "2026-08-03T13:00:00.000Z",
      updatedAt: "2026-08-03T13:00:00.000Z",
    },
    page: {
      id: "page-1",
      originalIndex: 0,
      sourceRectCss: { x: 0, y: 0, width: 800, height: 1_200 },
      pageWidthPt: 595.28,
      pageHeightPt: 841.89,
      imageRectPt: { x: 22.68, y: 22.68, width: 549.92, height: 756.14 },
    },
  };
}

function repositories(record: StoredTileRecord): {
  artifacts: ArtifactRepositoryPort;
  tiles: TileRepositoryPort;
  stored: () => ArtifactRecord | undefined;
} {
  let artifact: ArtifactRecord | undefined;
  return {
    artifacts: {
      put: (next) => {
        artifact = next;
        return Promise.resolve();
      },
      get: () => Promise.resolve(artifact),
      delete: () => Promise.resolve(false),
      deleteExpired: () => Promise.resolve(0),
    },
    tiles: {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(record),
      listByJob: () => Promise.resolve([record]),
      deleteByJob: () => Promise.resolve(0),
    },
    stored: () => artifact,
  };
}

describe("createPdfPageThumbnail", () => {
  it("uses a bounded canvas, closes each decoded tile, releases the canvas, and reuses cache", async () => {
    const input = source();
    const repository = repositories(input.record);
    let decodeCount = 0;
    let closeCount = 0;
    let releaseCount = 0;
    let drawCount = 0;
    const canvasSizes: Array<{ width: number; height: number }> = [];
    const environment: ThumbnailEnvironment = {
      decode: () => {
        decodeCount += 1;
        return Promise.resolve({
          width: 800,
          height: 1_200,
          source: {} as CanvasImageSource,
          close() {
            closeCount += 1;
          },
        });
      },
      createCanvas(width, height) {
        canvasSizes.push({ width, height });
        return {
          width,
          height,
          fillWhite: () => undefined,
          drawImage: () => {
            drawCount += 1;
          },
          encodeJpeg: () =>
            Promise.resolve(new Blob([new Uint8Array([4, 5, 6])], { type: "image/jpeg" })),
          release() {
            releaseCount += 1;
          },
        };
      },
    };

    const options = {
      jobId: "job-1",
      manifestRevision: 3,
      page: input.page,
      tiles: [input.tile],
      expiresAt: "2026-08-03T14:00:00.000Z",
      artifacts: repository.artifacts,
      tileRepository: repository.tiles,
      environment,
      now: () => new Date("2026-08-03T13:30:00.000Z"),
    };
    const first = await createPdfPageThumbnail(options);
    const second = await createPdfPageThumbnail(options);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      format: "jpeg",
      mimeType: "image/jpeg",
      width: 213,
      height: 320,
    });
    expect(Math.max(first.width, first.height)).toBeLessThanOrEqual(320);
    expect(canvasSizes).toEqual([{ width: 213, height: 320 }]);
    expect(decodeCount).toBe(1);
    expect(closeCount).toBe(1);
    expect(drawCount).toBe(1);
    expect(releaseCount).toBe(1);
    expect(repository.stored()).toMatchObject({ role: "thumbnail", jobId: "job-1" });
  });
});
