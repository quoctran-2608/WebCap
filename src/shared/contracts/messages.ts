import { z } from "zod";

import { CaptureCapabilitiesSchema, type CaptureCapabilities } from "@shared/capabilities";
import { PROTOCOL_VERSION } from "@shared/constants";
import { ArtifactMetadataSchema, type ArtifactMetadata } from "@shared/contracts/artifact";
import { ImageFormatSchema, type ImageFormat } from "@shared/contracts/domain";
import {
  WebCapErrorCodeSchema,
  WebCapErrorDataSchema,
  createWebCapError,
  type WebCapErrorData,
} from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

export { PROTOCOL_VERSION };

export const MessageEndpointSchema = z.enum([
  "popup",
  "editor",
  "background",
  "content",
  "offscreen",
]);

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const RequestIdSchema = z.string().min(1).max(160);
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();
const EnvelopeBaseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  sentAt: IsoDateTimeSchema,
});

export const TabCapabilityStatusSchema = z.enum(["supported", "unsupported", "unavailable"]);
export const TabCapabilityPayloadSchema = z
  .object({
    status: TabCapabilityStatusSchema,
    tabId: NonNegativeIntegerSchema.optional(),
    windowId: NonNegativeIntegerSchema.optional(),
    scheme: z.string().min(1).max(32).optional(),
    errorCode: WebCapErrorCodeSchema.optional(),
  })
  .strict();

export const VisibleCaptureMetadataSchema = z
  .object({
    captureId: z.string().min(1).max(160),
    tabId: NonNegativeIntegerSchema,
    windowId: NonNegativeIntegerSchema,
    mimeType: z.literal("image/png"),
    byteLength: PositiveIntegerSchema,
    width: PositiveIntegerSchema,
    height: PositiveIntegerSchema,
  })
  .strict();

export const PingMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("popup"),
  target: z.literal("background"),
  type: z.literal("PING"),
  payload: z
    .object({
      client: z.literal("webcap-popup"),
      clientVersion: z.string().min(1).max(80),
    })
    .strict(),
}).strict();

export const PongMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("popup"),
  type: z.literal("PONG"),
  payload: z
    .object({
      worker: z.literal("webcap-service-worker"),
      workerVersion: z.string().min(1).max(80),
      requestSentAt: IsoDateTimeSchema,
    })
    .strict(),
}).strict();

export const CapabilitiesGetMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("popup"),
  target: z.literal("background"),
  type: z.literal("CAPABILITIES_GET"),
  payload: z.object({}).strict(),
}).strict();

export const CapabilitiesResponseMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("popup"),
  type: z.literal("CAPABILITIES_RESPONSE"),
  payload: CaptureCapabilitiesSchema,
}).strict();

export const TabCapabilityGetMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("popup"),
  target: z.literal("background"),
  type: z.literal("TAB_CAPABILITY_GET"),
  payload: z.object({}).strict(),
}).strict();

export const TabCapabilityResponseMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("popup"),
  type: z.literal("TAB_CAPABILITY_RESPONSE"),
  payload: TabCapabilityPayloadSchema,
}).strict();

export const VisibleCaptureStartMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("popup"),
  target: z.literal("background"),
  type: z.literal("VISIBLE_CAPTURE_START"),
  payload: z.object({ format: z.literal("png") }).strict(),
}).strict();

export const VisibleCaptureSuccessMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("popup"),
  type: z.literal("VISIBLE_CAPTURE_SUCCESS"),
  payload: VisibleCaptureMetadataSchema,
}).strict();

export const VisibleCaptureCancelMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("popup"),
  target: z.literal("background"),
  type: z.literal("VISIBLE_CAPTURE_CANCEL"),
  payload: z.object({ captureRequestId: RequestIdSchema }).strict(),
}).strict();

export const VisibleCaptureCancelledMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("popup"),
  type: z.literal("VISIBLE_CAPTURE_CANCELLED"),
  payload: z
    .object({
      captureRequestId: RequestIdSchema,
      accepted: z.boolean(),
    })
    .strict(),
}).strict();

export const ImageExportStartMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("popup"),
  target: z.literal("background"),
  type: z.literal("IMAGE_EXPORT_START"),
  payload: z
    .object({
      sourceArtifactId: z.string().min(1).max(160),
      format: ImageFormatSchema,
      quality: z.number().finite().min(0).max(1),
    })
    .strict(),
}).strict();

export const ImageExportSuccessMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("popup"),
  type: z.literal("IMAGE_EXPORT_SUCCESS"),
  payload: ArtifactMetadataSchema,
}).strict();

export const ArtifactDownloadStartMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("popup"),
  target: z.literal("background"),
  type: z.literal("ARTIFACT_DOWNLOAD_START"),
  payload: z.object({ artifactId: z.string().min(1).max(160) }).strict(),
}).strict();

export const ArtifactDownloadStartedMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("popup"),
  type: z.literal("ARTIFACT_DOWNLOAD_STARTED"),
  payload: z
    .object({
      artifactId: z.string().min(1).max(160),
      downloadId: NonNegativeIntegerSchema,
    })
    .strict(),
}).strict();

export const ErrorResponseMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("popup"),
  type: z.literal("ERROR_RESPONSE"),
  payload: WebCapErrorDataSchema,
}).strict();

export const BackgroundRequestSchema = z.discriminatedUnion("type", [
  PingMessageSchema,
  CapabilitiesGetMessageSchema,
  TabCapabilityGetMessageSchema,
  VisibleCaptureStartMessageSchema,
  VisibleCaptureCancelMessageSchema,
  ImageExportStartMessageSchema,
  ArtifactDownloadStartMessageSchema,
]);

export const BackgroundResponseSchema = z.discriminatedUnion("type", [
  PongMessageSchema,
  CapabilitiesResponseMessageSchema,
  TabCapabilityResponseMessageSchema,
  VisibleCaptureSuccessMessageSchema,
  VisibleCaptureCancelledMessageSchema,
  ImageExportSuccessMessageSchema,
  ArtifactDownloadStartedMessageSchema,
  ErrorResponseMessageSchema,
]);

export type MessageEndpoint = z.infer<typeof MessageEndpointSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;
export type PongMessage = z.infer<typeof PongMessageSchema>;
export type CapabilitiesGetMessage = z.infer<typeof CapabilitiesGetMessageSchema>;
export type CapabilitiesResponseMessage = z.infer<typeof CapabilitiesResponseMessageSchema>;
export type TabCapabilityStatus = z.infer<typeof TabCapabilityStatusSchema>;
export type TabCapabilityPayload = z.infer<typeof TabCapabilityPayloadSchema>;
export type TabCapabilityGetMessage = z.infer<typeof TabCapabilityGetMessageSchema>;
export type TabCapabilityResponseMessage = z.infer<typeof TabCapabilityResponseMessageSchema>;
export type VisibleCaptureMetadata = z.infer<typeof VisibleCaptureMetadataSchema>;
export type VisibleCaptureStartMessage = z.infer<typeof VisibleCaptureStartMessageSchema>;
export type VisibleCaptureSuccessMessage = z.infer<typeof VisibleCaptureSuccessMessageSchema>;
export type VisibleCaptureCancelMessage = z.infer<typeof VisibleCaptureCancelMessageSchema>;
export type VisibleCaptureCancelledMessage = z.infer<typeof VisibleCaptureCancelledMessageSchema>;
export type ImageExportStartMessage = z.infer<typeof ImageExportStartMessageSchema>;
export type ImageExportSuccessMessage = z.infer<typeof ImageExportSuccessMessageSchema>;
export type ArtifactDownloadStartMessage = z.infer<typeof ArtifactDownloadStartMessageSchema>;
export type ArtifactDownloadStartedMessage = z.infer<typeof ArtifactDownloadStartedMessageSchema>;
export type ErrorResponseMessage = z.infer<typeof ErrorResponseMessageSchema>;
export type BackgroundRequest = z.infer<typeof BackgroundRequestSchema>;
export type BackgroundResponse = z.infer<typeof BackgroundResponseSchema>;

export interface MessageCreationOptions {
  requestId: string;
  sentAt: string;
}

export function createPingMessage(
  options: MessageCreationOptions & { clientVersion: string },
): PingMessage {
  return PingMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "PING",
    payload: { client: "webcap-popup", clientVersion: options.clientVersion },
    sentAt: options.sentAt,
  });
}

export function createPongMessage(
  options: MessageCreationOptions & { workerVersion: string; requestSentAt: string },
): PongMessage {
  return PongMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "PONG",
    payload: {
      worker: "webcap-service-worker",
      workerVersion: options.workerVersion,
      requestSentAt: options.requestSentAt,
    },
    sentAt: options.sentAt,
  });
}

export function createCapabilitiesGetMessage(
  options: MessageCreationOptions,
): CapabilitiesGetMessage {
  return CapabilitiesGetMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "CAPABILITIES_GET",
    payload: {},
    sentAt: options.sentAt,
  });
}

export function createCapabilitiesResponseMessage(
  options: MessageCreationOptions & { capabilities: CaptureCapabilities },
): CapabilitiesResponseMessage {
  return CapabilitiesResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "CAPABILITIES_RESPONSE",
    payload: options.capabilities,
    sentAt: options.sentAt,
  });
}

export function createTabCapabilityGetMessage(
  options: MessageCreationOptions,
): TabCapabilityGetMessage {
  return TabCapabilityGetMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "TAB_CAPABILITY_GET",
    payload: {},
    sentAt: options.sentAt,
  });
}

export function createTabCapabilityResponseMessage(
  options: MessageCreationOptions & { capability: TabCapabilityPayload },
): TabCapabilityResponseMessage {
  return TabCapabilityResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "TAB_CAPABILITY_RESPONSE",
    payload: options.capability,
    sentAt: options.sentAt,
  });
}

export function createVisibleCaptureStartMessage(
  options: MessageCreationOptions,
): VisibleCaptureStartMessage {
  return VisibleCaptureStartMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "VISIBLE_CAPTURE_START",
    payload: { format: "png" },
    sentAt: options.sentAt,
  });
}

export function createVisibleCaptureSuccessMessage(
  options: MessageCreationOptions & { metadata: VisibleCaptureMetadata },
): VisibleCaptureSuccessMessage {
  return VisibleCaptureSuccessMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "VISIBLE_CAPTURE_SUCCESS",
    payload: options.metadata,
    sentAt: options.sentAt,
  });
}

export function createVisibleCaptureCancelMessage(
  options: MessageCreationOptions & { captureRequestId: string },
): VisibleCaptureCancelMessage {
  return VisibleCaptureCancelMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "VISIBLE_CAPTURE_CANCEL",
    payload: { captureRequestId: options.captureRequestId },
    sentAt: options.sentAt,
  });
}

export function createVisibleCaptureCancelledMessage(
  options: MessageCreationOptions & { captureRequestId: string; accepted: boolean },
): VisibleCaptureCancelledMessage {
  return VisibleCaptureCancelledMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "VISIBLE_CAPTURE_CANCELLED",
    payload: {
      captureRequestId: options.captureRequestId,
      accepted: options.accepted,
    },
    sentAt: options.sentAt,
  });
}

export function createImageExportStartMessage(
  options: MessageCreationOptions & {
    sourceArtifactId: string;
    format: ImageFormat;
    quality: number;
  },
): ImageExportStartMessage {
  return ImageExportStartMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "IMAGE_EXPORT_START",
    payload: {
      sourceArtifactId: options.sourceArtifactId,
      format: options.format,
      quality: options.quality,
    },
    sentAt: options.sentAt,
  });
}

export function createImageExportSuccessMessage(
  options: MessageCreationOptions & { artifact: ArtifactMetadata },
): ImageExportSuccessMessage {
  return ImageExportSuccessMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "IMAGE_EXPORT_SUCCESS",
    payload: options.artifact,
    sentAt: options.sentAt,
  });
}

export function createArtifactDownloadStartMessage(
  options: MessageCreationOptions & { artifactId: string },
): ArtifactDownloadStartMessage {
  return ArtifactDownloadStartMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "ARTIFACT_DOWNLOAD_START",
    payload: { artifactId: options.artifactId },
    sentAt: options.sentAt,
  });
}

export function createArtifactDownloadStartedMessage(
  options: MessageCreationOptions & { artifactId: string; downloadId: number },
): ArtifactDownloadStartedMessage {
  return ArtifactDownloadStartedMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "ARTIFACT_DOWNLOAD_STARTED",
    payload: { artifactId: options.artifactId, downloadId: options.downloadId },
    sentAt: options.sentAt,
  });
}

export function createErrorResponseMessage(
  options: MessageCreationOptions & { error: WebCapErrorData },
): ErrorResponseMessage {
  return ErrorResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "ERROR_RESPONSE",
    payload: options.error,
    sentAt: options.sentAt,
  });
}

export function parseBackgroundRequest(value: unknown): Result<BackgroundRequest, WebCapErrorData> {
  const parsed = BackgroundRequestSchema.safeParse(value);
  if (parsed.success) {
    return ok(parsed.data);
  }

  const protocolVersion =
    typeof value === "object" && value !== null && "protocolVersion" in value
      ? (value as { protocolVersion?: unknown }).protocolVersion
      : undefined;
  const versionMatches = protocolVersion === PROTOCOL_VERSION;

  return err(
    createWebCapError({
      code: versionMatches ? "E_PROTOCOL_MESSAGE" : "E_PROTOCOL_VERSION",
      stage: "protocol",
      message: versionMatches
        ? "Runtime message does not match a supported schema."
        : "Runtime message uses an unsupported protocol version.",
      userMessageKey: versionMatches ? "errors.protocolMessage" : "errors.protocolVersion",
      retryable: false,
      fallbackAllowed: false,
      safeContext: {
        receivedProtocolVersion: typeof protocolVersion === "number" ? protocolVersion : "missing",
      },
    }),
  );
}

export function isPingMessage(value: unknown): value is PingMessage {
  return PingMessageSchema.safeParse(value).success;
}

export function isPongMessage(value: unknown): value is PongMessage {
  return PongMessageSchema.safeParse(value).success;
}

export function isCapabilitiesResponseMessage(
  value: unknown,
): value is CapabilitiesResponseMessage {
  return CapabilitiesResponseMessageSchema.safeParse(value).success;
}

export function isTabCapabilityResponseMessage(
  value: unknown,
): value is TabCapabilityResponseMessage {
  return TabCapabilityResponseMessageSchema.safeParse(value).success;
}

export function isVisibleCaptureSuccessMessage(
  value: unknown,
): value is VisibleCaptureSuccessMessage {
  return VisibleCaptureSuccessMessageSchema.safeParse(value).success;
}

export function isVisibleCaptureCancelledMessage(
  value: unknown,
): value is VisibleCaptureCancelledMessage {
  return VisibleCaptureCancelledMessageSchema.safeParse(value).success;
}

export function isImageExportSuccessMessage(value: unknown): value is ImageExportSuccessMessage {
  return ImageExportSuccessMessageSchema.safeParse(value).success;
}

export function isArtifactDownloadStartedMessage(
  value: unknown,
): value is ArtifactDownloadStartedMessage {
  return ArtifactDownloadStartedMessageSchema.safeParse(value).success;
}

export function isErrorResponseMessage(value: unknown): value is ErrorResponseMessage {
  return ErrorResponseMessageSchema.safeParse(value).success;
}
