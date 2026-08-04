import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import { ArtifactMetadataSchema, type ArtifactMetadata } from "@shared/contracts/artifact";
import { CaptureTileSchema } from "@shared/contracts/domain";
import { PdfEditorPageSchema, type PdfEditorPage } from "@shared/contracts/pdf-editor";

const IdentifierSchema = z.string().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const OffscreenPdfThumbnailMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("offscreen"),
    type: z.literal("OFFSCREEN_PDF_THUMBNAIL"),
    payload: z
      .object({
        jobId: IdentifierSchema,
        manifestRevision: z.number().int().nonnegative(),
        page: PdfEditorPageSchema,
        tiles: z.array(CaptureTileSchema).min(1).max(2_000),
        expiresAt: IsoDateTimeSchema,
      })
      .strict(),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const OffscreenPdfThumbnailCreatedMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("offscreen"),
    target: z.literal("background"),
    type: z.literal("OFFSCREEN_PDF_THUMBNAIL_CREATED"),
    payload: ArtifactMetadataSchema,
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export type OffscreenPdfThumbnailMessage = z.infer<typeof OffscreenPdfThumbnailMessageSchema>;
export type OffscreenPdfThumbnailCreatedMessage = z.infer<
  typeof OffscreenPdfThumbnailCreatedMessageSchema
>;

interface MessageOptions {
  requestId: string;
  sentAt: string;
}

export function createOffscreenPdfThumbnailMessage(
  options: MessageOptions & {
    jobId: string;
    manifestRevision: number;
    page: PdfEditorPage;
    tiles: z.infer<typeof CaptureTileSchema>[];
    expiresAt: string;
  },
): OffscreenPdfThumbnailMessage {
  return OffscreenPdfThumbnailMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "offscreen",
    type: "OFFSCREEN_PDF_THUMBNAIL",
    payload: {
      jobId: options.jobId,
      manifestRevision: options.manifestRevision,
      page: options.page,
      tiles: options.tiles,
      expiresAt: options.expiresAt,
    },
    sentAt: options.sentAt,
  });
}

export function createOffscreenPdfThumbnailCreatedMessage(
  options: MessageOptions & { artifact: ArtifactMetadata },
): OffscreenPdfThumbnailCreatedMessage {
  return OffscreenPdfThumbnailCreatedMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "offscreen",
    target: "background",
    type: "OFFSCREEN_PDF_THUMBNAIL_CREATED",
    payload: options.artifact,
    sentAt: options.sentAt,
  });
}

export function isOffscreenPdfThumbnailMessage(
  value: unknown,
): value is OffscreenPdfThumbnailMessage {
  return OffscreenPdfThumbnailMessageSchema.safeParse(value).success;
}

export function isOffscreenPdfThumbnailCreatedMessage(
  value: unknown,
): value is OffscreenPdfThumbnailCreatedMessage {
  return OffscreenPdfThumbnailCreatedMessageSchema.safeParse(value).success;
}
