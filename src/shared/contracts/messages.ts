import { z } from "zod";

import { CaptureCapabilitiesSchema, type CaptureCapabilities } from "@shared/capabilities";
import { PROTOCOL_VERSION } from "@shared/constants";
import {
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
const EnvelopeBaseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  sentAt: IsoDateTimeSchema,
});

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

export const ErrorResponseMessageSchema = EnvelopeBaseSchema.extend({
  source: z.literal("background"),
  target: z.literal("popup"),
  type: z.literal("ERROR_RESPONSE"),
  payload: WebCapErrorDataSchema,
}).strict();

export const BackgroundRequestSchema = z.discriminatedUnion("type", [
  PingMessageSchema,
  CapabilitiesGetMessageSchema,
]);

export const BackgroundResponseSchema = z.discriminatedUnion("type", [
  PongMessageSchema,
  CapabilitiesResponseMessageSchema,
  ErrorResponseMessageSchema,
]);

export type MessageEndpoint = z.infer<typeof MessageEndpointSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;
export type PongMessage = z.infer<typeof PongMessageSchema>;
export type CapabilitiesGetMessage = z.infer<typeof CapabilitiesGetMessageSchema>;
export type CapabilitiesResponseMessage = z.infer<typeof CapabilitiesResponseMessageSchema>;
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

export function isErrorResponseMessage(value: unknown): value is ErrorResponseMessage {
  return ErrorResponseMessageSchema.safeParse(value).success;
}
