import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  PdfExporter,
  type PdfDocumentPort,
  type PdfExportEnvironment,
} from "@offscreen/pdf-exporter";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

const TILE_HEIGHT_CSS = 8_192;
const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

interface BenchmarkScenario {
  name: string;
  widthCss: number;
  heightCss: number;
  jpegQuality: number;
}

interface BenchmarkResult {
  scenario: string;
  widthCss: number;
  heightCss: number;
  tileCount: number;
  pageCount: number;
  durationMs: number;
  artifactBytes: number;
  sourceTileBytes: number;
  maxDecodedTiles: number;
  maxCanvasPixelArea: number;
  estimatedWorkingSetBytes: number;
  memoryThresholdBytes: number;
  peakHeapBytes?: number | undefined;
}

function createSource(
  widthCss: number,
  heightCss: number,
): {
  tiles: CaptureTile[];
  records: StoredTileRecord[];
  dimensions: Map<Blob, { width: number; height: number }>;
} {
  const tiles: CaptureTile[] = [];
  const records: StoredTileRecord[] = [];
  const dimensions = new Map<Blob, { width: number; height: number }>();
  let y = 0;
  let index = 0;
  while (y < heightCss) {
    const height = Math.min(TILE_HEIGHT_CSS, heightCss - y);
    const tile: CaptureTile = {
      id: `benchmark-job:${index}`,
      jobId: "benchmark-job",
      index,
      row: index,
      column: 0,
      sourceRectCss: { x: 0, y, width: widthCss, height },
      outputRectCss: { x: 0, y, width: widthCss, height },
      expectedPixelWidth: widthCss,
      expectedPixelHeight: height,
      overlapTopCss: 0,
      overlapLeftCss: 0,
      overlapRightCss: 0,
      overlapBottomCss: 0,
      status: "stored",
      attempts: 1,
      byteLength: 4,
      mimeType: "image/png",
    };
    const blob = new Blob([new Uint8Array([index & 0xff, 1, 2, 3])], {
      type: "image/png",
    });
    dimensions.set(blob, { width: widthCss, height });
    tiles.push(tile);
    records.push({
      schemaVersion: 1,
      jobId: tile.jobId,
      index,
      tile,
      blob,
      createdAt: "2026-08-04T02:00:00.000Z",
      updatedAt: "2026-08-04T02:00:00.000Z",
    });
    y += height;
    index += 1;
  }
  return { tiles, records, dimensions };
}

function repositories(records: StoredTileRecord[]): {
  tiles: TileRepositoryPort;
  artifacts: ArtifactRepositoryPort;
  artifact: () => ArtifactRecord | undefined;
} {
  let artifact: ArtifactRecord | undefined;
  return {
    tiles: {
      put: () => Promise.resolve(),
      get: (_jobId, index) => Promise.resolve(records.find((record) => record.index === index)),
      listByJob: () => Promise.resolve(records),
      deleteByJob: () => Promise.resolve(0),
    },
    artifacts: {
      put: (next) => {
        artifact = next;
        return Promise.resolve();
      },
      get: () => Promise.resolve(artifact),
      delete: (artifactId) => {
        if (artifact?.artifactId !== artifactId) return Promise.resolve(false);
        artifact = undefined;
        return Promise.resolve(true);
      },
      deleteExpired: () => Promise.resolve(0),
    },
    artifact: () => artifact,
  };
}

async function realPdfDocument(): Promise<PdfDocumentPort> {
  const document = await PDFDocument.create();
  return {
    async addJpegPage(options) {
      const image = await document.embedJpg(options.bytes);
      const page = document.addPage([options.pageWidthPt, options.pageHeightPt]);
      page.drawImage(image, {
        x: options.imageRectPt.x,
        y: options.imageRectPt.y,
        width: options.imageRectPt.width,
        height: options.imageRectPt.height,
      });
    },
    save: () => document.save(),
  };
}

function benchmarkEnvironment(
  dimensions: Map<Blob, { width: number; height: number }>,
): PdfExportEnvironment {
  return {
    decode(blob) {
      const size = dimensions.get(blob);
      if (size === undefined) return Promise.reject(new Error("Unknown benchmark tile."));
      return Promise.resolve({
        ...size,
        source: {} as CanvasImageSource,
        close: () => undefined,
      });
    },
    createCanvas: (width, height) => ({
      width,
      height,
      getContext: () => ({ fillWhite: () => undefined, drawImage: () => undefined }),
      convertToJpeg: () =>
        Promise.resolve(new Blob([Uint8Array.from(ONE_PIXEL_JPEG).buffer], { type: "image/jpeg" })),
      release: () => undefined,
    }),
    createDocument: realPdfDocument,
    now: () => performance.now(),
    readHeapSnapshot: () => ({
      usedBytes: process.memoryUsage().heapUsed,
      limitBytes: 768 * 1_024 * 1_024,
    }),
  };
}

async function runScenario(scenario: BenchmarkScenario): Promise<BenchmarkResult> {
  const source = createSource(scenario.widthCss, scenario.heightCss);
  const repository = repositories(source.records);
  const exporter = new PdfExporter({
    tiles: repository.tiles,
    artifacts: repository.artifacts,
    environment: benchmarkEnvironment(source.dimensions),
  });
  const result = await exporter.export({
    jobId: "benchmark-job",
    outputArtifactId: `benchmark-${scenario.name}`,
    targetRect: { x: 0, y: 0, width: scenario.widthCss, height: scenario.heightCss },
    tiles: source.tiles,
    settings: {
      ...DEFAULT_CAPTURE_SETTINGS.pdf,
      jpegQuality: scenario.jpegQuality,
    },
    filename: `${scenario.name}.pdf`,
    createdAt: "2026-08-04T02:01:00.000Z",
    expiresAt: "2026-08-04T02:31:00.000Z",
  });
  const artifact = repository.artifact();
  if (artifact === undefined) throw new Error("Benchmark artifact was not persisted.");

  return {
    scenario: scenario.name,
    widthCss: scenario.widthCss,
    heightCss: scenario.heightCss,
    tileCount: source.tiles.length,
    pageCount: result.diagnostics.pageCount,
    durationMs: Math.round(result.diagnostics.durationMs * 100) / 100,
    artifactBytes: artifact.blob.size,
    sourceTileBytes: source.records.reduce((total, record) => total + (record.blob?.size ?? 0), 0),
    maxDecodedTiles: result.diagnostics.maxDecodedTiles,
    maxCanvasPixelArea: result.diagnostics.maxCanvasPixelArea,
    estimatedWorkingSetBytes: result.diagnostics.memoryEstimate.estimatedWorkingSetBytes,
    memoryThresholdBytes: result.diagnostics.memoryEstimate.thresholdBytes,
    ...(result.diagnostics.peakHeapBytes === undefined
      ? {}
      : { peakHeapBytes: result.diagnostics.peakHeapBytes }),
  };
}

const scenarios: BenchmarkScenario[] = [
  { name: "pdf-1440x10k", widthCss: 1_440, heightCss: 10_000, jpegQuality: 0.82 },
  { name: "pdf-1440x30k", widthCss: 1_440, heightCss: 30_000, jpegQuality: 0.82 },
  { name: "pdf-1440x100k", widthCss: 1_440, heightCss: 100_000, jpegQuality: 0.82 },
  { name: "pdf-wide-4096x30k", widthCss: 4_096, heightCss: 30_000, jpegQuality: 0.75 },
];

describe("PDF export performance reference", () => {
  for (const scenario of scenarios) {
    it(`exports ${scenario.name} with bounded page-at-a-time resources`, async () => {
      const result = await runScenario(scenario);
      process.stdout.write(`${JSON.stringify({ type: "webcap-pdf-benchmark", ...result })}\n`);

      expect(result.pageCount).toBeGreaterThan(0);
      expect(result.artifactBytes).toBeGreaterThan(0);
      expect(result.maxDecodedTiles).toBe(1);
      expect(result.estimatedWorkingSetBytes).toBeLessThanOrEqual(result.memoryThresholdBytes);
      expect(result.durationMs).toBeLessThan(30_000);
      expect(result.maxCanvasPixelArea).toBeLessThan(scenario.widthCss * scenario.heightCss);
    });
  }
});
