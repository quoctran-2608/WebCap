import { z } from "zod";

import { ImageFormatSchema } from "@shared/contracts/domain";

const PositiveIntegerSchema = z.number().int().positive();
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const ArtifactMimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
export const ArtifactRoleSchema = z.enum(["source", "output"]);

export const ArtifactMetadataSchema = z
  .object({
    artifactId: z.string().min(1).max(160),
    sourceArtifactId: z.string().min(1).max(160),
    format: ImageFormatSchema,
    mimeType: ArtifactMimeTypeSchema,
    filename: z.string().min(1).max(180),
    byteLength: PositiveIntegerSchema,
    width: PositiveIntegerSchema,
    height: PositiveIntegerSchema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

export type ArtifactMimeType = z.infer<typeof ArtifactMimeTypeSchema>;
export type ArtifactRole = z.infer<typeof ArtifactRoleSchema>;
export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

export interface ArtifactRecord extends ArtifactMetadata {
  jobId: string;
  role: ArtifactRole;
  blob: Blob;
  sourceTitle?: string;
  sourceDomain?: string;
}

export function mimeTypeForFormat(format: z.infer<typeof ImageFormatSchema>): ArtifactMimeType {
  switch (format) {
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
  }
}
