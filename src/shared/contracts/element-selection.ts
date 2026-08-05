import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import {
  ElementTargetDescriptorSchema,
  RectSchema,
  type ElementTargetDescriptor,
} from "@shared/contracts/domain";
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

export const ElementSelectionOpenMessageSchema = BackgroundToContentSchema.extend({
  type: z.literal("ELEMENT_SELECTION_OPEN"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      captureKind: ElementTargetDescriptorSchema.shape.captureKind,
    })
    .strict(),
}).strict();

export const ElementSelectionCloseMessageSchema = BackgroundToContentSchema.extend({
  type: z.literal("ELEMENT_SELECTION_CLOSE"),
  payload: z.object({ jobId: IdentifierSchema }).strict(),
}).strict();

export const ElementSelectionClosedMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("ELEMENT_SELECTION_CLOSED"),
  payload: z.object({ jobId: IdentifierSchema, closed: z.boolean() }).strict(),
}).strict();

export const ElementSelectionOpenedMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("ELEMENT_SELECTION_OPENED"),
  payload: z.object({ jobId: IdentifierSchema, reused: z.boolean() }).strict(),
}).strict();

export const ElementSelectionErrorMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("ELEMENT_SELECTION_ERROR"),
  payload: WebCapErrorDataSchema,
}).strict();

export const ElementSelectionCommitMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("ELEMENT_SELECTION_COMMIT"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      rect: RectSchema.refine((rect) => rect.width >= 1 && rect.height >= 1, {
        message: "Selected element bounds must be non-empty.",
      }),
      descriptor: ElementTargetDescriptorSchema,
    })
    .strict(),
}).strict();

export const ElementSelectionCancelMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("ELEMENT_SELECTION_CANCEL"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      reason: z.string().min(1).max(300).optional(),
    })
    .strict(),
}).strict();

export const ElementSelectionEventSchema = z.discriminatedUnion("type", [
  ElementSelectionCommitMessageSchema,
  ElementSelectionCancelMessageSchema,
]);

export const ElementSelectionEventAckMessageSchema = BackgroundToContentSchema.extend({
  type: z.literal("ELEMENT_SELECTION_EVENT_ACK"),
  payload: z.object({ jobId: IdentifierSchema, accepted: z.boolean() }).strict(),
}).strict();

export const ElementTargetRevalidateMessageSchema = BackgroundToContentSchema.extend({
  type: z.literal("ELEMENT_TARGET_REVALIDATE"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      descriptor: ElementTargetDescriptorSchema,
    })
    .strict(),
}).strict();

export const ElementTargetValidatedMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("ELEMENT_TARGET_VALIDATED"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      descriptor: ElementTargetDescriptorSchema,
      rect: RectSchema.refine((rect) => rect.width >= 1 && rect.height >= 1),
    })
    .strict(),
}).strict();

export type ElementSelectionOpenMessage = z.infer<typeof ElementSelectionOpenMessageSchema>;
export type ElementSelectionCloseMessage = z.infer<typeof ElementSelectionCloseMessageSchema>;
export type ElementSelectionClosedMessage = z.infer<typeof ElementSelectionClosedMessageSchema>;
export type ElementSelectionOpenedMessage = z.infer<typeof ElementSelectionOpenedMessageSchema>;
export type ElementSelectionCommitMessage = z.infer<typeof ElementSelectionCommitMessageSchema>;
export type ElementSelectionCancelMessage = z.infer<typeof ElementSelectionCancelMessageSchema>;
export type ElementSelectionEvent = z.infer<typeof ElementSelectionEventSchema>;
export type ElementSelectionEventAckMessage = z.infer<typeof ElementSelectionEventAckMessageSchema>;
export type ElementTargetRevalidateMessage = z.infer<typeof ElementTargetRevalidateMessageSchema>;
export type ElementTargetValidatedMessage = z.infer<typeof ElementTargetValidatedMessageSchema>;

export function createElementSelectionOpenMessage(options: {
  requestId: string;
  jobId: string;
  captureKind: ElementTargetDescriptor["captureKind"];
  sentAt: string;
}): ElementSelectionOpenMessage {
  return ElementSelectionOpenMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "ELEMENT_SELECTION_OPEN",
    payload: { jobId: options.jobId, captureKind: options.captureKind },
    sentAt: options.sentAt,
  });
}

export function createElementSelectionCloseMessage(options: {
  requestId: string;
  jobId: string;
  sentAt: string;
}): ElementSelectionCloseMessage {
  return ElementSelectionCloseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "ELEMENT_SELECTION_CLOSE",
    payload: { jobId: options.jobId },
    sentAt: options.sentAt,
  });
}

export function createElementSelectionEventAckMessage(options: {
  requestId: string;
  jobId: string;
  accepted: boolean;
  sentAt: string;
}): ElementSelectionEventAckMessage {
  return ElementSelectionEventAckMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "ELEMENT_SELECTION_EVENT_ACK",
    payload: { jobId: options.jobId, accepted: options.accepted },
    sentAt: options.sentAt,
  });
}

export function createElementTargetRevalidateMessage(options: {
  requestId: string;
  jobId: string;
  descriptor: ElementTargetDescriptor;
  sentAt: string;
}): ElementTargetRevalidateMessage {
  return ElementTargetRevalidateMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "ELEMENT_TARGET_REVALIDATE",
    payload: { jobId: options.jobId, descriptor: options.descriptor },
    sentAt: options.sentAt,
  });
}

export function parseElementSelectionOpenResponse(
  value: unknown,
  expectedRequestId: string,
): Result<ElementSelectionOpenedMessage, WebCapErrorData> {
  const opened = ElementSelectionOpenedMessageSchema.safeParse(value);
  if (opened.success && opened.data.requestId === expectedRequestId) {
    return ok(opened.data);
  }
  const failure = ElementSelectionErrorMessageSchema.safeParse(value);
  if (failure.success && failure.data.requestId === expectedRequestId) {
    return err(failure.data.payload);
  }
  return err(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The content script returned an invalid element selection response.",
      userMessageKey: "errors.elementSelectionProtocol",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "InvalidElementSelectionResponse",
    }),
  );
}

export function parseElementSelectionCloseResponse(
  value: unknown,
  expectedRequestId: string,
): Result<ElementSelectionClosedMessage, WebCapErrorData> {
  const closed = ElementSelectionClosedMessageSchema.safeParse(value);
  if (closed.success && closed.data.requestId === expectedRequestId) {
    return ok(closed.data);
  }
  const failure = ElementSelectionErrorMessageSchema.safeParse(value);
  if (failure.success && failure.data.requestId === expectedRequestId) {
    return err(failure.data.payload);
  }
  return err(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The content script returned an invalid element selector close response.",
      userMessageKey: "errors.elementSelectionProtocol",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "InvalidElementSelectionCloseResponse",
    }),
  );
}

export function parseElementSelectionEvent(
  value: unknown,
): Result<ElementSelectionEvent, WebCapErrorData> {
  const parsed = ElementSelectionEventSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        createWebCapError({
          code: "E_PROTOCOL_MESSAGE",
          stage: "protocol",
          message: "Element selection event does not match the supported schema.",
          userMessageKey: "errors.elementSelectionProtocol",
          retryable: false,
          fallbackAllowed: false,
          causeCode: "InvalidElementSelectionEvent",
        }),
      );
}

export function parseElementTargetRevalidateResponse(
  value: unknown,
  expectedRequestId: string,
): Result<ElementTargetValidatedMessage, WebCapErrorData> {
  const validated = ElementTargetValidatedMessageSchema.safeParse(value);
  if (validated.success && validated.data.requestId === expectedRequestId) {
    return ok(validated.data);
  }
  const failure = ElementSelectionErrorMessageSchema.safeParse(value);
  if (failure.success && failure.data.requestId === expectedRequestId) {
    return err(failure.data.payload);
  }
  return err(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The content script returned an invalid element target response.",
      userMessageKey: "errors.elementSelectionProtocol",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "InvalidElementTargetResponse",
    }),
  );
}

export function isElementSelectionEventType(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "ELEMENT_SELECTION_COMMIT" || type === "ELEMENT_SELECTION_CANCEL";
}
