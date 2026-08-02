import type { ArtifactMetadata } from "@shared/contracts/artifact";
import {
  IndexedDbArtifactRepository,
  type ArtifactRepositoryPort,
} from "@storage/artifact-repository";

export interface ObjectUrlAdapter {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface ArtifactPreviewHandle {
  url: string;
  metadata: ArtifactMetadata;
  revoke(): void;
}

export interface ArtifactPreviewOptions {
  artifacts?: ArtifactRepositoryPort;
  objectUrls?: ObjectUrlAdapter;
}

const browserObjectUrls: ObjectUrlAdapter = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
};

export async function createArtifactPreview(
  artifactId: string,
  options: ArtifactPreviewOptions = {},
): Promise<ArtifactPreviewHandle> {
  const artifacts = options.artifacts ?? new IndexedDbArtifactRepository();
  const objectUrls = options.objectUrls ?? browserObjectUrls;
  const record = await artifacts.get(artifactId);

  if (record === undefined || record.role !== "output" || record.blob.size <= 0) {
    throw new Error("The preview artifact is unavailable.");
  }

  const url = objectUrls.createObjectURL(record.blob);
  let revoked = false;

  return {
    url,
    metadata: {
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
    },
    revoke: () => {
      if (!revoked) {
        revoked = true;
        objectUrls.revokeObjectURL(url);
      }
    },
  };
}
