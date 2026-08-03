import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import { RectSchema, type Rect } from "@shared/contracts/domain";
import {
  WebCapErrorDataSchema,
  createWebCapError,
  type WebCapErrorData,
} from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

const IdentifierSchema = z.string().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });

const BackgroundToContentSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("content"),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

const ContentToBackgroundSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("content"),
    target: z.literal("background"),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const RegionSelectionOpenMessageSchema = BackgroundToContentSchema.extend({
  type: z.literal("REGION_SELECTION_OPEN"),
  payload: z.object({ jobId: IdentifierSchema }).strict(),
}).strict();

export const RegionSelectionOpenedMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("content"),
    target: z.literal("background"),
    type: z.literal("REGION_SELECTION_OPENED"),
    payload: z
      .object({
        jobId: IdentifierSchema,
        reused: z.boolean(),
      })
      .strict(),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const RegionSelectionOpenErrorMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("content"),
    target: z.literal("background"),
    type: z.literal("REGION_SELECTION_ERROR"),
    payload: WebCapErrorDataSchema,
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const RegionSelectionCommitMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("REGION_SELECTION_COMMIT"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      rect: RectSchema.refine((rect) => rect.width >= 2 && rect.height >= 2, {
        message: "Selected region must be at least 2 CSS pixels in each dimension.",
      }),
    })
    .strict(),
}).strict();

export const RegionSelectionCancelMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("REGION_SELECTION_CANCEL"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      reason: z.string().min(1).max(300).optional(),
    })
    .strict(),
}).strict();

export const RegionSelectionEventSchema = z.discriminatedUnion("type", [
  RegionSelectionCommitMessageSchema,
  RegionSelectionCancelMessageSchema,
]);

export const RegionSelectionEventAckMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("content"),
    type: z.literal("REGION_SELECTION_EVENT_ACK"),
    payload: z
      .object({
        jobId: IdentifierSchema,
        accepted: z.boolean(),
      })
      .strict(),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export type RegionSelectionOpenMessage = z.infer<typeof RegionSelectionOpenMessageSchema>;
export type RegionSelectionOpenedMessage = z.infer<typeof RegionSelectionOpenedMessageSchema>;
export type RegionSelectionOpenErrorMessage = z.infer<typeof RegionSelectionOpenErrorMessageSchema>;
export type RegionSelectionCommitMessage = z.infer<typeof RegionSelectionCommitMessageSchema>;
export type RegionSelectionCancelMessage = z.infer<typeof RegionSelectionCancelMessageSchema>;
export type RegionSelectionEvent = z.infer<typeof RegionSelectionEventSchema>;
export type RegionSelectionEventAckMessage = z.infer<typeof RegionSelectionEventAckMessageSchema>;

export function createRegionSelectionOpenMessage(options: {
  requestId: string;
  jobId: string;
  sentAt: string;
}): RegionSelectionOpenMessage {
  return RegionSelectionOpenMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "REGION_SELECTION_OPEN",
    payload: { jobId: options.jobId },
    sentAt: options.sentAt,
  });
}

export function createRegionSelectionCommitMessage(options: {
  requestId: string;
  jobId: string;
  rect: Rect;
  sentAt: string;
}): RegionSelectionCommitMessage {
  return RegionSelectionCommitMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "content",
    target: "background",
    type: "REGION_SELECTION_COMMIT",
    payload: { jobId: options.jobId, rect: options.rect },
    sentAt: options.sentAt,
  });
}

export function createRegionSelectionCancelMessage(options: {
  requestId: string;
  jobId: string;
  reason?: string;
  sentAt: string;
}): RegionSelectionCancelMessage {
  return RegionSelectionCancelMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "content",
    target: "background",
    type: "REGION_SELECTION_CANCEL",
    payload: {
      jobId: options.jobId,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
    },
    sentAt: options.sentAt,
  });
}

export function createRegionSelectionEventAckMessage(options: {
  requestId: string;
  jobId: string;
  accepted: boolean;
  sentAt: string;
}): RegionSelectionEventAckMessage {
  return RegionSelectionEventAckMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "REGION_SELECTION_EVENT_ACK",
    payload: { jobId: options.jobId, accepted: options.accepted },
    sentAt: options.sentAt,
  });
}

export function parseRegionSelectionOpenResponse(
  value: unknown,
  expectedRequestId: string,
): Result<RegionSelectionOpenedMessage, WebCapErrorData> {
  const opened = RegionSelectionOpenedMessageSchema.safeParse(value);
  if (opened.success && opened.data.requestId === expectedRequestId) {
    return ok(opened.data);
  }
  const failure = RegionSelectionOpenErrorMessageSchema.safeParse(value);
  if (failure.success && failure.data.requestId === expectedRequestId) {
    return err(failure.data.payload);
  }
  return err(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The content script returned an invalid region selection response.",
      userMessageKey: "errors.regionSelectionProtocol",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "InvalidRegionSelectionResponse",
    }),
  );
}

export function parseRegionSelectionEvent(
  value: unknown,
): Result<RegionSelectionEvent, WebCapErrorData> {
  const parsed = RegionSelectionEventSchema.safeParse(value);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "Region selection event does not match the supported schema.",
      userMessageKey: "errors.regionSelectionProtocol",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "InvalidRegionSelectionEvent",
    }),
  );
}

export function isRegionSelectionEventType(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "REGION_SELECTION_COMMIT" || type === "REGION_SELECTION_CANCEL";
}
