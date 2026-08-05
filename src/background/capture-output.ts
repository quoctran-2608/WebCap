import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureOutput } from "@shared/contracts/domain";

export function captureOutputFromArtifact(artifact: ArtifactMetadata): CaptureOutput {
  return {
    artifactId: artifact.artifactId,
    sourceArtifactId: artifact.sourceArtifactId,
    format: artifact.format,
    mimeType: artifact.mimeType,
    filename: artifact.filename,
    byteLength: artifact.byteLength,
    width: artifact.width,
    height: artifact.height,
    createdAt: artifact.createdAt,
    expiresAt: artifact.expiresAt,
    ...(artifact.pageCount === undefined ? {} : { pageCount: artifact.pageCount }),
  };
}
