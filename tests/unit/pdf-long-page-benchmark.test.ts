import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { PdfExportSupervisor } from "@offscreen/pdf-export-supervisor";
import {
  PdfExporter,
  type PdfDocumentPort,
  type PdfExportEnvironment,
  type PdfPageCanvasPort,
} from "@offscreen/pdf-exporter";
import { planPdfDocument } from "@offscreen/pdf-layout";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile } from "@shared/contracts/domain";
import type { StoredTileRecord } from "@shared/contracts/job";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

const TILE_HEIGHT_CSS = 8_192;
const HEAP_LIMIT_BYTES = 512 * 1_024 * 1_024;
const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

interface BenchmarkScenario {
  name: string;
  widthCss: number;
  heightCss: number;
}

interface BenchmarkMetric {
  name: string;
  widthCss: number;
  heightCss: number;
  tileCount: number;
  tileBytes: number;
  pageCount: number;
  artifactBytes: number;
  durationMs: number;
  heapPeakBytes: number | undefined;
  maxDecodedTiles: number;
  maxCanvasPixelArea: number;
}

const scenarios: BenchmarkScenario[] = [
  { name: "long-10k", widthCss: 1_440, heightCss: 10_000 },
  { name: "long-30k", widthCss: 1_440, heightCss: 30_000 },
  { name: "long-100k", widthCss: 1_440, heightCss: 100_000 },
  { name: "wide-table-30k", widthCss: 4_096, heightCss: 30_000 },
];

function tilesFor(scenario: BenchmarkScenario): {
  tiles: CaptureTile[];
  records: StoredTileRecord[];
} {
  const tiles: CaptureTile[] = [];
  const records: StoredTileRecord[] = [];
  let offset = 0;
  while (offset < scenario.heightCss) {
    const height = Math.min(TILE_HEIGHT_CSS, scenario.heightCss - offset);
    const index = tiles.length;
    const tile: CaptureTile = {
      id: `${scenario.name}:${index}`,
      jobId: scenario.name,
      index,
      row: index,
      column: 0,
      sourceRectCss: { x: 0, y: offset, width: scenario.widthCss, height },
      outputRectCss: { x: 0, y: offset, width: scenario.widthCss, height },
      expectedPixelWidth: scenario.widthCss,
      expectedPixelHeight: height,
      overlapTopCss: 0,
      overlapLeftCss: 0,
      overlapRightCss: 0,
      overlapBottomCss: 0,
      status: "stored",
      attempts: 1,
      byteLength: 4_096,
      mimeType: "image/png",
    };
    tiles.push(tile);
    records.push({
      schemaVersion: 1,
      jobId: scenario.name,
      index,
      tile,
      blob: new Blob([new Uint8Array(4_096)], { type: "image/png" }),
      createdAt: "2026-08-04T02:00:00.000Z",
      updatedAt: "2026-08-04T02:00:00.000Z",
    });
    offset += height;
  }
  return { tiles, records };
}

function repositories(records: StoredTileRecord[]): {
  tiles: TileRepositoryPort;
  artifacts: ArtifactRepositoryPort;
  output: () => ArtifactRecord | undefined;
} {
  let artifact: ArtifactRecord | undefined;
  return {
    tiles: {
      put: () => Promise.resolve(),
      get: (jobId, index) =>
        Promise.resolve(records.find((record) => record.jobId === jobId && record.index === index)),
      listByJob: (jobId) => Promise.resolve(records.filter((record) => record.jobId === jobId)),
      deleteByJob: () => Promise.resolve(0),
    },
    artifacts: {
      put: (record) => {
        artifact = record;
        return Promise.resolve();
      },
      get: (artifactId) =>
        Promise.resolve(artifact?.artifactId === artifactId ? artifact : undefined),
      delete: (artifactId) => {
        if (artifact?.artifactId !== artifactId) return Promise.resolve(false);
        artifact = undefined;
        return Promise.resolve(true);
      },
      deleteExpired: () => Promise.resolve(0),
    },
    output: () => artifact,
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

function benchmarkEnvironment(): PdfExportEnvironment {
  return {
    decode: (_blob) =>
      Promise.resolve({
        width: 4_096,
        height: TILE_HEIGHT_CSS,
        source: {} as CanvasImageSource,
        close: () => undefined,
      }),
    createCanvas(width, height): PdfPageCanvasPort {
      return {
        width,
        height,
        getContext: () => ({
          fillWhite: () => undefined,
          drawImage: () => undefined,
        }),
        convertToJpeg: () =>
          Promise.resolve(
            new Blob([Uint8Array.from(ONE_PIXEL_JPEG).buffer], { type: "image/jpeg" }),
          ),
        release: () => undefined,
      };
    },
    createDocument: realPdfDocument,
  };
}

async function runScenario(scenario: BenchmarkScenario): Promise<BenchmarkMetric> {
  const source = tilesFor(scenario);
  const repository = repositories(source.records);
  const exporter = new PdfExporter({
    tiles: repository.tiles,
    artifacts: repository.artifacts,
    environment: benchmarkEnvironment(),
  });
  const supervisor = new PdfExportSupervisor({
    exporter,
    tiles: repository.tiles,
    artifacts: repository.artifacts,
    environment: {
      now: () => performance.now(),
      memory: () => ({
        usedJSHeapSize: process.memoryUsage().heapUsed,
        jsHeapSizeLimit: HEAP_LIMIT_BYTES,
      }),
    },
  });
  const targetRect = { x: 0, y: 0, width: scenario.widthCss, height: scenario.heightCss };
  const result = await supervisor.export({
    jobId: scenario.name,
    outputArtifactId: `pdf-${scenario.name}`,
    targetRect,
    tiles: source.tiles,
    settings: DEFAULT_CAPTURE_SETTINGS.pdf,
    filename: `${scenario.name}.pdf`,
    createdAt: "2026-08-04T02:01:00.000Z",
    expiresAt: "2026-08-04T02:31:00.000Z",
  });
  const plannedPages = planPdfDocument(targetRect, DEFAULT_CAPTURE_SETTINGS.pdf).pages.length;
  const output = repository.output();

  expect(output?.blob.size ?? 0).toBeGreaterThan(0);
  expect(result.artifact.pageCount).toBe(plannedPages);
  expect(result.diagnostics.pageCount).toBe(plannedPages);
  expect(result.diagnostics.maxDecodedTiles).toBeLessThanOrEqual(2);
  expect(result.diagnostics.releasedCanvasCount).toBe(plannedPages);
  expect(result.diagnostics.maxCanvasPixelArea).toBeLessThan(
    scenario.widthCss * scenario.heightCss,
  );
  expect(result.diagnostics.integrityImageObjectCount).toBeGreaterThanOrEqual(plannedPages);
  expect(result.diagnostics.integrityNonEmptyStreamCount).toBeGreaterThanOrEqual(plannedPages);
  expect(result.diagnostics.estimatedPeakWorkingSetBytes).toBeLessThan(
    result.diagnostics.memoryThresholdBytes,
  );

  return {
    name: scenario.name,
    widthCss: scenario.widthCss,
    heightCss: scenario.heightCss,
    tileCount: source.tiles.length,
    tileBytes: result.diagnostics.tileBytes,
    pageCount: plannedPages,
    artifactBytes: result.diagnostics.artifactBytes,
    durationMs: result.diagnostics.durationMs,
    heapPeakBytes: result.diagnostics.heapPeakBytes,
    maxDecodedTiles: result.diagnostics.maxDecodedTiles,
    maxCanvasPixelArea: result.diagnostics.maxCanvasPixelArea,
  };
}

describe("PDF long-page benchmark", () => {
  it("exports 10k, 30k, 100k and wide-table scenarios with bounded resources", async () => {
    const metrics: BenchmarkMetric[] = [];
    for (const scenario of scenarios) metrics.push(await runScenario(scenario));

    console.info(`WEBCAP_PDF_BENCHMARK=${JSON.stringify(metrics)}`);
    expect(metrics.map((metric) => metric.heightCss)).toEqual([
      10_000,
      30_000,
      100_000,
      30_000,
    ]);
    expect(metrics.every((metric) => metric.artifactBytes > 0)).toBe(true);
    expect(metrics.every((metric) => metric.maxDecodedTiles <= 2)).toBe(true);
    expect(metrics.every((metric) => metric.durationMs >= 0)).toBe(true);
  }, 30_000);
});
