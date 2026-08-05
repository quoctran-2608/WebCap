import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import { ArtifactMetadataSchema } from "@shared/contracts/artifact";
import {
  CaptureSettingsSchema,
  CaptureTileSchema,
  ImageFormatSchema,
  RectSchema,
} from "@shared/contracts/domain";
import { WebCapErrorDataSchema, type WebCapErrorData } from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const RequestIdSchema = z.string().min(1).max(160);
const EnvelopeBaseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  sentAt: IsoDateTimeSchema,
});

export const OffscreenPingMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("offscreen"),
  type: z.literal("OFFSCREEN_PING"),
  payload: z.object({}).strict(),
}).strict();

export const OffscreenReadyMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("offscreen"),
  target: z.literal("background"),
  type: z.literal("OFFSCREEN_READY"),
  payload: z.object({}).strict(),
}).strict();

export const OffscreenProcessImageMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("offscreen"),
  type: z.literal("OFFSCREEN_PROCESS_IMAGE"),
  payload: z
    .object({
      sourceArtifactId: z.string().min(1).max(160),
      outputArtifactId: z.string().min(1).max(160),
      format: ImageFormatSchema,
      quality: z.number().finite().min(0).max(1),
      filename: z.string().min(1).max(180),
      createdAt: IsoDateTimeSchema,
      expiresAt: IsoDateTimeSchema,
    })
    .strict(),
}).strict();

export const OffscreenExportTiledImageMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("offscreen"),
  type: z.literal("OFFSCREEN_EXPORT_TILED_IMAGE"),
  payload: z
    .object({
      jobId: z.string().min(1).max(160),
      outputArtifactId: z.string().min(1).max(160),
      targetRect: RectSchema,
      tiles: z.array(CaptureTileSchema).min(1),
      format: ImageFormatSchema,
      quality: z.number().finite().min(0).max(1),
      filename: z.string().min(1).max(180),
      createdAt: IsoDateTimeSchema,
      expiresAt: IsoDateTimeSchema,
      sourceTitle: z.string().max(300).optional(),
      sourceDomain: z.string().max(300).optional(),
    })
    .strict(),
}).strict();

export const OffscreenImageProcessedMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("offscreen"),
  target: z.literal("background"),
  type: z.literal("OFFSCREEN_IMAGE_PROCESSED"),
  payload: ArtifactMetadataSchema,
}).strict();

export const OffscreenExportPdfMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("offscreen"),
  type: z.literal("OFFSCREEN_EXPORT_PDF"),
  payload: z
    .object({
      jobId: z.string().min(1).max(160),
      outputArtifactId: z.string().min(1).max(160),
      targetRect: RectSchema,
      tiles: z.array(CaptureTileSchema).min(1),
      settings: CaptureSettingsSchema.shape.pdf,
      filename: z.string().min(1).max(180),
      createdAt: IsoDateTimeSchema,
      expiresAt: IsoDateTimeSchema,
      sourceTitle: z.string().max(300).optional(),
      sourceDomain: z.string().max(300).optional(),
    })
    .strict(),
}).strict();

export const OffscreenPdfExportedMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("offscreen"),
  target: z.literal("background"),
  type: z.literal("OFFSCREEN_PDF_EXPORTED"),
  payload: ArtifactMetadataSchema,
}).strict();

export const OffscreenPdfExportProgressMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("offscreen"),
  target: z.literal("background"),
  type: z.literal("OFFSCREEN_PDF_EXPORT_PROGRESS"),
  payload: z
    .object({
      jobId: z.string().min(1).max(160),
      completedPages: z.number().int().nonnegative(),
      totalPages: z.number().int().positive(),
    })
    .strict(),
}).strict();

export const OffscreenPdfExportProgressAckMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("offscreen"),
  type: z.literal("OFFSCREEN_PDF_EXPORT_PROGRESS_ACK"),
  payload: z
    .object({
      jobId: z.string().min(1).max(160),
      accepted: z.boolean(),
    })
    .strict(),
}).strict();

export const OffscreenCreateObjectUrlMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("offscreen"),
  type: z.literal("OFFSCREEN_CREATE_OBJECT_URL"),
  payload: z.object({ artifactId: z.string().min(1).max(160) }).strict(),
}).strict();

export const OffscreenObjectUrlCreatedMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("offscreen"),
  target: z.literal("background"),
  type: z.literal("OFFSCREEN_OBJECT_URL_CREATED"),
  payload: z.object({ url: z.string().url() }).strict(),
}).strict();

export const OffscreenRevokeObjectUrlMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("offscreen"),
  type: z.literal("OFFSCREEN_REVOKE_OBJECT_URL"),
  payload: z.object({ url: z.string().url() }).strict(),
}).strict();

export const OffscreenObjectUrlRevokedMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("offscreen"),
  target: z.literal("background"),
  type: z.literal("OFFSCREEN_OBJECT_URL_REVOKED"),
  payload: z.object({ revoked: z.boolean() }).strict(),
}).strict();

export const OffscreenErrorMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("offscreen"),
  target: z.literal("background"),
  type: z.literal("OFFSCREEN_ERROR"),
  payload: WebCapErrorDataSchema,
}).strict();

export const OffscreenRequestSchema = z.discriminatedUnion("type", [
  OffscreenPingMessageSchema,
  OffscreenProcessImageMessageSchema,
  OffscreenExportTiledImageMessageSchema,
  OffscreenExportPdfMessageSchema,
  OffscreenCreateObjectUrlMessageSchema,
  OffscreenRevokeObjectUrlMessageSchema,
]);

export const OffscreenResponseSchema = z.discriminatedUnion("type", [
  OffscreenReadyMessageSchema,
  OffscreenImageProcessedMessageSchema,
  OffscreenPdfExportedMessageSchema,
  OffscreenPdfExportProgressAckMessageSchema,
  OffscreenObjectUrlCreatedMessageSchema,
  OffscreenObjectUrlRevokedMessageSchema,
  OffscreenErrorMessageSchema,
]);

export type OffscreenPingMessage = z.infer<typeof OffscreenPingMessageSchema>;
export type OffscreenReadyMessage = z.infer<typeof OffscreenReadyMessageSchema>;
export type OffscreenProcessImageMessage = z.infer<typeof OffscreenProcessImageMessageSchema>;
export type OffscreenExportTiledImageMessage = z.infer<
  typeof OffscreenExportTiledImageMessageSchema
>;
export type OffscreenImageProcessedMessage = z.infer<typeof OffscreenImageProcessedMessageSchema>;
export type OffscreenExportPdfMessage = z.infer<typeof OffscreenExportPdfMessageSchema>;
export type OffscreenPdfExportedMessage = z.infer<typeof OffscreenPdfExportedMessageSchema>;
export type OffscreenPdfExportProgressMessage = z.infer<
  typeof OffscreenPdfExportProgressMessageSchema
>;
export type OffscreenPdfExportProgressAckMessage = z.infer<
  typeof OffscreenPdfExportProgressAckMessageSchema
>;
export type OffscreenCreateObjectUrlMessage = z.infer<typeof OffscreenCreateObjectUrlMessageSchema>;
export type OffscreenObjectUrlCreatedMessage = z.infer<
  typeof OffscreenObjectUrlCreatedMessageSchema
>;
export type OffscreenRevokeObjectUrlMessage = z.infer<typeof OffscreenRevokeObjectUrlMessageSchema>;
export type OffscreenObjectUrlRevokedMessage = z.infer<
  typeof OffscreenObjectUrlRevokedMessageSchema
>;
export type OffscreenErrorMessage = z.infer<typeof OffscreenErrorMessageSchema>;
export type OffscreenRequest = z.infer<typeof OffscreenRequestSchema>;
export type OffscreenResponse = z.infer<typeof OffscreenResponseSchema>;

interface MessageOptions {
  requestId: string;
  sentAt: string;
}

export function createOffscreenPingMessage(options: MessageOptions): OffscreenPingMessage {
  return OffscreenPingMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "offscreen",
    type: "OFFSCREEN_PING",
    payload: {},
    sentAt: options.sentAt,
  });
}

export function createOffscreenReadyMessage(options: MessageOptions): OffscreenReadyMessage {
  return OffscreenReadyMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "offscreen",
    target: "background",
    type: "OFFSCREEN_READY",
    payload: {},
    sentAt: options.sentAt,
  });
}

export function createOffscreenProcessImageMessage(
  options: MessageOptions & OffscreenProcessImageMessage["payload"],
): OffscreenProcessImageMessage {
  return OffscreenProcessImageMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "offscreen",
    type: "OFFSCREEN_PROCESS_IMAGE",
    payload: {
      sourceArtifactId: options.sourceArtifactId,
      outputArtifactId: options.outputArtifactId,
      format: options.format,
      quality: options.quality,
      filename: options.filename,
      createdAt: options.createdAt,
      expiresAt: options.expiresAt,
    },
    sentAt: options.sentAt,
  });
}

export function createOffscreenExportTiledImageMessage(
  options: MessageOptions & OffscreenExportTiledImageMessage["payload"],
): OffscreenExportTiledImageMessage {
  return OffscreenExportTiledImageMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "offscreen",
    type: "OFFSCREEN_EXPORT_TILED_IMAGE",
    payload: {
      jobId: options.jobId,
      outputArtifactId: options.outputArtifactId,
      targetRect: options.targetRect,
      tiles: options.tiles,
      format: options.format,
      quality: options.quality,
      filename: options.filename,
      createdAt: options.createdAt,
      expiresAt: options.expiresAt,
      ...(options.sourceTitle === undefined ? {} : { sourceTitle: options.sourceTitle }),
      ...(options.sourceDomain === undefined ? {} : { sourceDomain: options.sourceDomain }),
    },
    sentAt: options.sentAt,
  });
}

export function createOffscreenImageProcessedMessage(
  options: MessageOptions & { artifact: OffscreenImageProcessedMessage["payload"] },
): OffscreenImageProcessedMessage {
  return OffscreenImageProcessedMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "offscreen",
    target: "background",
    type: "OFFSCREEN_IMAGE_PROCESSED",
    payload: options.artifact,
    sentAt: options.sentAt,
  });
}

export function createOffscreenExportPdfMessage(
  options: MessageOptions & OffscreenExportPdfMessage["payload"],
): OffscreenExportPdfMessage {
  return OffscreenExportPdfMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "offscreen",
    type: "OFFSCREEN_EXPORT_PDF",
    payload: {
      jobId: options.jobId,
      outputArtifactId: options.outputArtifactId,
      targetRect: options.targetRect,
      tiles: options.tiles,
      settings: options.settings,
      filename: options.filename,
      createdAt: options.createdAt,
      expiresAt: options.expiresAt,
      ...(options.sourceTitle === undefined ? {} : { sourceTitle: options.sourceTitle }),
      ...(options.sourceDomain === undefined ? {} : { sourceDomain: options.sourceDomain }),
    },
    sentAt: options.sentAt,
  });
}

export function createOffscreenPdfExportedMessage(
  options: MessageOptions & { artifact: OffscreenPdfExportedMessage["payload"] },
): OffscreenPdfExportedMessage {
  return OffscreenPdfExportedMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "offscreen",
    target: "background",
    type: "OFFSCREEN_PDF_EXPORTED",
    payload: options.artifact,
    sentAt: options.sentAt,
  });
}

export function createOffscreenPdfExportProgressMessage(
  options: MessageOptions & OffscreenPdfExportProgressMessage["payload"],
): OffscreenPdfExportProgressMessage {
  return OffscreenPdfExportProgressMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "offscreen",
    target: "background",
    type: "OFFSCREEN_PDF_EXPORT_PROGRESS",
    payload: {
      jobId: options.jobId,
      completedPages: options.completedPages,
      totalPages: options.totalPages,
    },
    sentAt: options.sentAt,
  });
}

export function createOffscreenPdfExportProgressAckMessage(
  options: MessageOptions & OffscreenPdfExportProgressAckMessage["payload"],
): OffscreenPdfExportProgressAckMessage {
  return OffscreenPdfExportProgressAckMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "offscreen",
    type: "OFFSCREEN_PDF_EXPORT_PROGRESS_ACK",
    payload: { jobId: options.jobId, accepted: options.accepted },
    sentAt: options.sentAt,
  });
}

export function createOffscreenCreateObjectUrlMessage(
  options: MessageOptions & { artifactId: string },
): OffscreenCreateObjectUrlMessage {
  return OffscreenCreateObjectUrlMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "offscreen",
    type: "OFFSCREEN_CREATE_OBJECT_URL",
    payload: { artifactId: options.artifactId },
    sentAt: options.sentAt,
  });
}

export function createOffscreenObjectUrlCreatedMessage(
  options: MessageOptions & { url: string },
): OffscreenObjectUrlCreatedMessage {
  return OffscreenObjectUrlCreatedMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "offscreen",
    target: "background",
    type: "OFFSCREEN_OBJECT_URL_CREATED",
    payload: { url: options.url },
    sentAt: options.sentAt,
  });
}

export function createOffscreenRevokeObjectUrlMessage(
  options: MessageOptions & { url: string },
): OffscreenRevokeObjectUrlMessage {
  return OffscreenRevokeObjectUrlMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "offscreen",
    type: "OFFSCREEN_REVOKE_OBJECT_URL",
    payload: { url: options.url },
    sentAt: options.sentAt,
  });
}

export function createOffscreenObjectUrlRevokedMessage(
  options: MessageOptions & { revoked: boolean },
): OffscreenObjectUrlRevokedMessage {
  return OffscreenObjectUrlRevokedMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "offscreen",
    target: "background",
    type: "OFFSCREEN_OBJECT_URL_REVOKED",
    payload: { revoked: options.revoked },
    sentAt: options.sentAt,
  });
}

export function createOffscreenErrorMessage(
  options: MessageOptions & { error: WebCapErrorData },
): OffscreenErrorMessage {
  return OffscreenErrorMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "offscreen",
    target: "background",
    type: "OFFSCREEN_ERROR",
    payload: options.error,
    sentAt: options.sentAt,
  });
}

export function parseOffscreenRequest(value: unknown): Result<OffscreenRequest, WebCapErrorData> {
  const parsed = OffscreenRequestSchema.safeParse(value);
  if (parsed.success) {
    return ok(parsed.data);
  }

  return err({
    code: "E_PROTOCOL_MESSAGE",
    stage: "protocol",
    message: "Offscreen message does not match a supported schema.",
    userMessageKey: "errors.protocolMessage",
    retryable: false,
    fallbackAllowed: false,
  });
}

export function isOffscreenReadyMessage(value: unknown): value is OffscreenReadyMessage {
  return OffscreenReadyMessageSchema.safeParse(value).success;
}

export function isOffscreenImageProcessedMessage(
  value: unknown,
): value is OffscreenImageProcessedMessage {
  return OffscreenImageProcessedMessageSchema.safeParse(value).success;
}

export function isOffscreenPdfExportedMessage(
  value: unknown,
): value is OffscreenPdfExportedMessage {
  return OffscreenPdfExportedMessageSchema.safeParse(value).success;
}

export function isOffscreenPdfExportProgressMessage(
  value: unknown,
): value is OffscreenPdfExportProgressMessage {
  return OffscreenPdfExportProgressMessageSchema.safeParse(value).success;
}

export function isOffscreenObjectUrlCreatedMessage(
  value: unknown,
): value is OffscreenObjectUrlCreatedMessage {
  return OffscreenObjectUrlCreatedMessageSchema.safeParse(value).success;
}

export function isOffscreenObjectUrlRevokedMessage(
  value: unknown,
): value is OffscreenObjectUrlRevokedMessage {
  return OffscreenObjectUrlRevokedMessageSchema.safeParse(value).success;
}

export function isOffscreenErrorMessage(value: unknown): value is OffscreenErrorMessage {
  return OffscreenErrorMessageSchema.safeParse(value).success;
}

export function isOffscreenPingMessage(value: unknown): value is OffscreenPingMessage {
  return OffscreenPingMessageSchema.safeParse(value).success;
}
