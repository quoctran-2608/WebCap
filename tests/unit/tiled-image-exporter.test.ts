import { describe, expect, it, vi } from "vitest";

import {
  TiledImageExporter,
  type DecodedTiledImage,
  type TiledImageCanvasContextPort,
} from "@offscreen/tiled-image-exporter";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

const NOW = "2026-08-05T08:00:00.000Z";

function tiles(): CaptureTile[] {
  return [
    {
      id: "job:0",
      jobId: "job",
      index: 0,
      row: 0,
      column: 0,
      sourceRectCss: { x: 0, y: 0, width: 100, height: 100 },
      outputRectCss: { x: 0, y: 0, width: 100, height: 100 },
      expectedPixelWidth: 100,
      expectedPixelHeight: 100,
      overlapTopCss: 0,
      overlapLeftCss: 0,
      overlapRightCss: 0,
      overlapBottomCss: 0,
      status: "stored",
      attempts: 1,
    },
    {
      id: "job:1",
      jobId: "job",
      index: 1,
      row: 1,
      column: 0,
      sourceRectCss: { x: 0, y: 80, width: 100, height: 100 },
      outputRectCss: { x: 0, y: 100, width: 100, height: 80 },
      expectedPixelWidth: 100,
      expectedPixelHeight: 100,
      overlapTopCss: 20,
      overlapLeftCss: 0,
      overlapRightCss: 0,
      overlapBottomCss: 0,
      status: "stored",
      attempts: 1,
    },
  ];
}

function records(planned = tiles()): StoredTileRecord[] {
  return planned.map((tile) => ({
    schemaVersion: 1,
    jobId: tile.jobId,
    index: tile.index,
    tile,
    blob: new Blob([new Uint8Array([tile.index + 1])], { type: "image/png" }),
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

function tileRepository(values: StoredTileRecord[]): TileRepositoryPort {
  return {
    put: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    listByJob: () => Promise.resolve(values),
    deleteByJob: () => Promise.resolve(0),
  };
}

function artifactRepository(
  put: (record: ArtifactRecord) => Promise<void>,
): ArtifactRepositoryPort {
  return {
    put,
    get: () => Promise.resolve(undefined),
    delete: () => Promise.resolve(false),
    deleteExpired: () => Promise.resolve(0),
  };
}

describe("TiledImageExporter", () => {
  it("uses seam-aware crops, decodes sequentially, and stores one guarded image", async () => {
    const drawCalls: number[][] = [];
    const context: TiledImageCanvasContextPort = {
      drawImage: (_image, ...coordinates) => drawCalls.push(coordinates),
    };
    let activeDecoded = 0;
    let maxDecoded = 0;
    const closes: Array<ReturnType<typeof vi.fn>> = [];
    const release = vi.fn();
    const put = vi.fn((record: ArtifactRecord): Promise<void> => {
      void record;
      return Promise.resolve();
    });
    const exporter = new TiledImageExporter({
      tiles: tileRepository(records()),
      artifacts: artifactRepository(put),
      environment: {
        decode(): Promise<DecodedTiledImage> {
          activeDecoded += 1;
          maxDecoded = Math.max(maxDecoded, activeDecoded);
          const close = vi.fn(() => {
            activeDecoded -= 1;
          });
          closes.push(close);
          return Promise.resolve({
            width: 100,
            height: 100,
            source: {} as CanvasImageSource,
            close,
          });
        },
        createCanvas(width, height) {
          expect({ width, height }).toEqual({ width: 100, height: 180 });
          return {
            width,
            height,
            getContext: () => context,
            convertToBlob: () =>
              Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
            release,
          };
        },
      },
    });

    const artifact = await exporter.export({
      jobId: "job",
      outputArtifactId: "output",
      targetRect: { x: 0, y: 0, width: 100, height: 180 },
      tiles: tiles(),
      format: "png",
      quality: 0.9,
      filename: "capture.png",
      createdAt: NOW,
      expiresAt: "2026-08-05T08:30:00.000Z",
    });

    expect(maxDecoded).toBe(1);
    expect(closes).toHaveLength(2);
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true);
    expect(drawCalls).toEqual([
      [0, 0, 100, 100, 0, 0, 100, 100],
      [0, 20, 100, 80, 0, 100, 100, 80],
    ]);
    expect(release).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "output",
        jobId: "job",
        role: "output",
        format: "png",
        width: 100,
        height: 180,
      }),
    );
    expect(artifact).toMatchObject({ artifactId: "output", mimeType: "image/png" });
  });

  it("rejects unsafe dimensions before allocating a canvas", async () => {
    const planned = tiles().map((tile, index) => ({
      ...tile,
      sourceRectCss: { ...tile.sourceRectCss, width: 20_000 },
      outputRectCss: {
        x: 0,
        y: index === 0 ? 0 : 100,
        width: 20_000,
        height: index === 0 ? 100 : 80,
      },
      expectedPixelWidth: 20_000,
    }));
    const createCanvas = vi.fn();
    const exporter = new TiledImageExporter({
      tiles: tileRepository(records(planned)),
      artifacts: artifactRepository(() => Promise.resolve()),
      environment: {
        decode: () => Promise.reject(new Error("decode should not run")),
        createCanvas,
      },
    });

    await expect(
      exporter.export({
        jobId: "job",
        outputArtifactId: "output",
        targetRect: { x: 0, y: 0, width: 20_000, height: 180 },
        tiles: planned,
        format: "jpeg",
        quality: 0.8,
        filename: "capture.jpg",
        createdAt: NOW,
        expiresAt: "2026-08-05T08:30:00.000Z",
      }),
    ).rejects.toMatchObject({
      name: "E_IMAGE_OUTPUT_TOO_LARGE",
      data: { fallbackAllowed: true, causeCode: "ImageCanvasDimensionGuard" },
    });
    expect(createCanvas).not.toHaveBeenCalled();
  });
});
