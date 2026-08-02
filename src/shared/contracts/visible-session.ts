import { z } from "zod";

import { ArtifactMetadataSchema } from "@shared/contracts/artifact";
import { ImageFormatSchema } from "@shared/contracts/domain";
import { WebCapErrorDataSchema } from "@shared/errors/error";

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();
const IdentifierSchema = z.string().min(1).max(160);

export const VisibleSessionStatusSchema = z.enum([
  "capturing",
  "captured",
  "processing",
  "ready",
  "downloading",
  "completed",
  "cancelled",
  "error",
]);

export const VisibleSourceMetadataSchema = z
  .object({
    captureId: IdentifierSchema,
    tabId: NonNegativeIntegerSchema,
    windowId: NonNegativeIntegerSchema,
    mimeType: z.literal("image/png"),
    byteLength: PositiveIntegerSchema,
    width: PositiveIntegerSchema,
    height: PositiveIntegerSchema,
  })
  .strict();

export const VisibleSessionSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: IdentifierSchema,
    captureRequestId: IdentifierSchema,
    status: VisibleSessionStatusSchema,
    format: ImageFormatSchema,
    quality: z.number().finite().min(0).max(1),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    source: VisibleSourceMetadataSchema.optional(),
    artifact: ArtifactMetadataSchema.optional(),
    downloadId: NonNegativeIntegerSchema.optional(),
    error: WebCapErrorDataSchema.optional(),
  })
  .strict();

export type VisibleSessionStatus = z.infer<typeof VisibleSessionStatusSchema>;
export type VisibleSourceMetadata = z.infer<typeof VisibleSourceMetadataSchema>;
export type VisibleSessionSnapshot = z.infer<typeof VisibleSessionSnapshotSchema>;
