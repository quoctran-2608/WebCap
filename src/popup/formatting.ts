import type { ImageFormat } from "@shared/contracts/domain";

const FORMAT_ESTIMATE_RATIO: Record<ImageFormat, number> = {
  png: 1,
  jpeg: 0.58,
  webp: 0.46,
};

export function formatBytes(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`;
  }
  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`;
  }
  return `${(byteLength / (1024 * 1024)).toFixed(2)} MB`;
}

export function estimateOutputBytes(sourceByteLength: number, format: ImageFormat): number {
  return Math.max(1, Math.round(sourceByteLength * FORMAT_ESTIMATE_RATIO[format]));
}
