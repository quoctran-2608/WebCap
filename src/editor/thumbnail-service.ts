import { planPdfTileIntersections } from "@offscreen/pdf-tile-intersections";
import type { ArtifactMetadata, ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureTile } from "@shared/contracts/domain";
import type { PdfEditorPage } from "@shared/contracts/pdf-editor";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";
import { IndexedDbTileRepository } from "@storage/tile-repository";

const THUMBNAIL_MAX_EDGE = 320;
const THUMBNAIL_QUALITY = 0.62;

let renderQueue: Promise<void> = Promise.resolve();

export interface DecodedThumbnailTile {
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
}

export interface ThumbnailCanvasPort {
  width: number;
  height: number;
  fillWhite(): void;
  drawImage(
    image: DecodedThumbnailTile,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    destinationX: number,
    destinationY: number,
    destinationWidth: number,
    destinationHeight: number,
  ): void;
  encodeJpeg(quality: number): Promise<Blob>;
  release(): void;
}

export interface ThumbnailEnvironment {
  decode(blob: Blob): Promise<DecodedThumbnailTile>;
  createCanvas(width: number, height: number): ThumbnailCanvasPort;
}

export interface PdfThumbnailOptions {
  jobId: string;
  manifestRevision: number;
  page: PdfEditorPage;
  tiles: CaptureTile[];
  expiresAt: string;
  artifacts?: ArtifactRepositoryPort;
  tileRepository?: TileRepositoryPort;
  environment?: ThumbnailEnvironment;
  now?: () => Date;
}

function scheduleRender<T>(operation: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(operation, operation);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function artifactIdFor(jobId: string, revision: number, pageId: string): string {
  let hash = 2166136261;
  for (const character of `${jobId}:${revision}:${pageId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `pdf-thumb-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function metadata(record: ArtifactRecord): ArtifactMetadata {
  return {
    artifactId: record.artifactId,
    sourceArtifactId: record.sourceArtifactId,
    format: record.format,
    mimeType: record.mimeType,
    filename: record.filename,
    byteLength: record.byteLength,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

function roundRange(
  start: number,
  end: number,
  maximum: number,
): { start: number; length: number } {
  const roundedStart = Math.max(0, Math.min(maximum, Math.round(start)));
  const roundedEnd = Math.max(roundedStart, Math.min(maximum, Math.round(end)));
  return { start: roundedStart, length: roundedEnd - roundedStart };
}

const browserEnvironment: ThumbnailEnvironment = {
  async decode(blob) {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  },
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("PDF thumbnail canvas is unavailable.");
    return {
      width,
      height,
      fillWhite() {
        context.save();
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.restore();
      },
      drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        destinationX,
        destinationY,
        destinationWidth,
        destinationHeight,
      ) {
        context.drawImage(
          image.source,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          destinationX,
          destinationY,
          destinationWidth,
          destinationHeight,
        );
      },
      encodeJpeg(quality) {
        return new Promise((resolve, reject) => {
          canvas.toBlob(
            (blob) =>
              blob === null ? reject(new Error("PDF thumbnail encoding failed.")) : resolve(blob),
            "image/jpeg",
            quality,
          );
        });
      },
      release() {
        canvas.width = 1;
        canvas.height = 1;
      },
    };
  },
};

async function renderPdfPageThumbnail(options: PdfThumbnailOptions): Promise<ArtifactMetadata> {
  const artifacts = options.artifacts ?? new IndexedDbArtifactRepository();
  const tiles = options.tileRepository ?? new IndexedDbTileRepository();
  const environment = options.environment ?? browserEnvironment;
  const now = options.now ?? (() => new Date());
  const artifactId = artifactIdFor(options.jobId, options.manifestRevision, options.page.id);
  const cached = await artifacts.get(artifactId);
  if (cached !== undefined && cached.role === "thumbnail" && cached.blob.size > 0) {
    return metadata(cached);
  }

  const records = await tiles.listByJob(options.jobId);
  const recordByIndex = new Map(records.map((record) => [record.index, record]));
  const pageRect = options.page.sourceRectCss;
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(pageRect.width, pageRect.height));
  const width = Math.max(1, Math.round(pageRect.width * scale));
  const height = Math.max(1, Math.round(pageRect.height * scale));
  const canvas = environment.createCanvas(width, height);
  canvas.fillWhite();

  try {
    const intersections = planPdfTileIntersections(pageRect, options.tiles);
    for (const intersection of intersections) {
      const tile = options.tiles.find((candidate) => candidate.index === intersection.tileIndex);
      const record = recordByIndex.get(intersection.tileIndex);
      if (tile === undefined || record?.blob === undefined) {
        throw new Error("A source tile required for the PDF thumbnail is unavailable.");
      }
      const decoded = await environment.decode(record.blob);
      try {
        const tileScaleX = decoded.width / tile.sourceRectCss.width;
        const tileScaleY = decoded.height / tile.sourceRectCss.height;
        const sourceX = roundRange(
          intersection.sourceCropCss.x * tileScaleX,
          (intersection.sourceCropCss.x + intersection.sourceCropCss.width) * tileScaleX,
          decoded.width,
        );
        const sourceY = roundRange(
          intersection.sourceCropCss.y * tileScaleY,
          (intersection.sourceCropCss.y + intersection.sourceCropCss.height) * tileScaleY,
          decoded.height,
        );
        const destinationX = roundRange(
          (intersection.logicalRectCss.x - pageRect.x) * scale,
          (intersection.logicalRectCss.x + intersection.logicalRectCss.width - pageRect.x) * scale,
          width,
        );
        const destinationY = roundRange(
          (intersection.logicalRectCss.y - pageRect.y) * scale,
          (intersection.logicalRectCss.y + intersection.logicalRectCss.height - pageRect.y) * scale,
          height,
        );
        if (
          sourceX.length <= 0 ||
          sourceY.length <= 0 ||
          destinationX.length <= 0 ||
          destinationY.length <= 0
        ) {
          throw new Error("PDF thumbnail tile crop is empty.");
        }
        canvas.drawImage(
          decoded,
          sourceX.start,
          sourceY.start,
          sourceX.length,
          sourceY.length,
          destinationX.start,
          destinationY.start,
          destinationX.length,
          destinationY.length,
        );
      } finally {
        decoded.close();
      }
    }

    const blob = await canvas.encodeJpeg(THUMBNAIL_QUALITY);
    if (blob.size <= 0) throw new Error("PDF thumbnail artifact is empty.");
    const createdAt = now().toISOString();
    const record: ArtifactRecord = {
      artifactId,
      sourceArtifactId: options.jobId,
      jobId: options.jobId,
      role: "thumbnail",
      format: "jpeg",
      mimeType: "image/jpeg",
      filename: `${options.page.id}.jpg`,
      byteLength: blob.size,
      width,
      height,
      createdAt,
      expiresAt: options.expiresAt,
      blob,
    };
    await artifacts.put(record);
    return metadata(record);
  } finally {
    canvas.release();
  }
}

export function createPdfPageThumbnail(options: PdfThumbnailOptions): Promise<ArtifactMetadata> {
  return scheduleRender(() => renderPdfPageThumbnail(options));
}
