import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import {
  DocumentPageMapSchema,
  ElementTargetDescriptorSchema,
  FixedElementModeSchema,
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
const NonNegativeFiniteSchema = z.number().finite().nonnegative();
const PositiveFiniteSchema = z.number().finite().positive();
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

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

export const ScrollAreaScrollMessageSchema = BackgroundToContentSchema.extend({
  type: z.literal("SCROLL_AREA_SCROLL"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      descriptor: ElementTargetDescriptorSchema.refine(
        (descriptor) => descriptor.captureKind === "full-scroll-content",
      ),
      scrollLeft: NonNegativeFiniteSchema,
      scrollTop: NonNegativeFiniteSchema,
      row: NonNegativeIntegerSchema,
      column: NonNegativeIntegerSchema,
      rows: PositiveIntegerSchema,
      columns: PositiveIntegerSchema,
      fixedElementMode: FixedElementModeSchema,
      settleMs: NonNegativeIntegerSchema,
      expectedScrollWidth: PositiveFiniteSchema.optional(),
      expectedScrollHeight: PositiveFiniteSchema.optional(),
      expectedClientWidth: PositiveFiniteSchema.optional(),
      expectedClientHeight: PositiveFiniteSchema.optional(),
    })
    .strict(),
}).strict();

export const ScrollAreaScrolledMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("SCROLL_AREA_SCROLLED"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      descriptor: ElementTargetDescriptorSchema,
      requestedScrollLeft: NonNegativeFiniteSchema,
      requestedScrollTop: NonNegativeFiniteSchema,
      actualScrollLeft: NonNegativeFiniteSchema,
      actualScrollTop: NonNegativeFiniteSchema,
      scrollWidth: PositiveFiniteSchema,
      scrollHeight: PositiveFiniteSchema,
      clientWidth: PositiveFiniteSchema,
      clientHeight: PositiveFiniteSchema,
      viewportWidth: PositiveFiniteSchema,
      viewportHeight: PositiveFiniteSchema,
      devicePixelRatio: PositiveFiniteSchema,
      captureCropCss: RectSchema.refine((rect) => rect.width > 0 && rect.height > 0),
      hiddenStickyElements: NonNegativeIntegerSchema,
      stableSamples: NonNegativeIntegerSchema,
      mutationCount: NonNegativeIntegerSchema,
      scrollSnapped: z.boolean(),
      layoutChanged: z.boolean(),
      documentPageMap: DocumentPageMapSchema.optional(),
    })
    .strict(),
}).strict();

export const ScrollAreaCleanupMessageSchema = BackgroundToContentSchema.extend({
  type: z.literal("SCROLL_AREA_CLEANUP"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      descriptor: ElementTargetDescriptorSchema.refine(
        (descriptor) => descriptor.captureKind === "full-scroll-content",
      ),
    })
    .strict(),
}).strict();

export const ScrollAreaCleanedMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("SCROLL_AREA_CLEANED"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      restoredElements: NonNegativeIntegerSchema,
      skippedElements: NonNegativeIntegerSchema,
      scrollRestored: z.boolean(),
      documentScrollRestored: z.boolean(),
    })
    .strict(),
}).strict();

export const ScrollAreaErrorMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("SCROLL_AREA_ERROR"),
  payload: WebCapErrorDataSchema,
}).strict();

export type ScrollAreaScrollMessage = z.infer<typeof ScrollAreaScrollMessageSchema>;
export type ScrollAreaScrolledMessage = z.infer<typeof ScrollAreaScrolledMessageSchema>;
export type ScrollAreaCleanupMessage = z.infer<typeof ScrollAreaCleanupMessageSchema>;
export type ScrollAreaCleanedMessage = z.infer<typeof ScrollAreaCleanedMessageSchema>;

export function createScrollAreaScrollMessage(options: {
  requestId: string;
  sentAt: string;
  jobId: string;
  descriptor: ElementTargetDescriptor;
  scrollLeft: number;
  scrollTop: number;
  row: number;
  column: number;
  rows: number;
  columns: number;
  fixedElementMode: z.infer<typeof FixedElementModeSchema>;
  settleMs: number;
  expectedScrollWidth?: number;
  expectedScrollHeight?: number;
  expectedClientWidth?: number;
  expectedClientHeight?: number;
}): ScrollAreaScrollMessage {
  return ScrollAreaScrollMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "SCROLL_AREA_SCROLL",
    payload: {
      jobId: options.jobId,
      descriptor: options.descriptor,
      scrollLeft: options.scrollLeft,
      scrollTop: options.scrollTop,
      row: options.row,
      column: options.column,
      rows: options.rows,
      columns: options.columns,
      fixedElementMode: options.fixedElementMode,
      settleMs: options.settleMs,
      ...(options.expectedScrollWidth === undefined
        ? {}
        : { expectedScrollWidth: options.expectedScrollWidth }),
      ...(options.expectedScrollHeight === undefined
        ? {}
        : { expectedScrollHeight: options.expectedScrollHeight }),
      ...(options.expectedClientWidth === undefined
        ? {}
        : { expectedClientWidth: options.expectedClientWidth }),
      ...(options.expectedClientHeight === undefined
        ? {}
        : { expectedClientHeight: options.expectedClientHeight }),
    },
    sentAt: options.sentAt,
  });
}

export function createScrollAreaCleanupMessage(options: {
  requestId: string;
  sentAt: string;
  jobId: string;
  descriptor: ElementTargetDescriptor;
}): ScrollAreaCleanupMessage {
  return ScrollAreaCleanupMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "SCROLL_AREA_CLEANUP",
    payload: {
      jobId: options.jobId,
      descriptor: options.descriptor,
    },
    sentAt: options.sentAt,
  });
}

export function parseScrollAreaScrollResponse(
  value: unknown,
  expectedRequestId: string,
): Result<ScrollAreaScrolledMessage, WebCapErrorData> {
  const success = ScrollAreaScrolledMessageSchema.safeParse(value);
  if (success.success && success.data.requestId === expectedRequestId) return ok(success.data);
  const failure = ScrollAreaErrorMessageSchema.safeParse(value);
  if (failure.success && failure.data.requestId === expectedRequestId)
    return err(failure.data.payload);
  return err(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The content script returned an invalid scroll-area response.",
      userMessageKey: "errors.scrollAreaProtocol",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "InvalidScrollAreaResponse",
    }),
  );
}

export function parseScrollAreaCleanupResponse(
  value: unknown,
  expectedRequestId: string,
): Result<ScrollAreaCleanedMessage, WebCapErrorData> {
  const success = ScrollAreaCleanedMessageSchema.safeParse(value);
  if (success.success && success.data.requestId === expectedRequestId) return ok(success.data);
  const failure = ScrollAreaErrorMessageSchema.safeParse(value);
  if (failure.success && failure.data.requestId === expectedRequestId)
    return err(failure.data.payload);
  return err(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The content script returned an invalid scroll-area cleanup response.",
      userMessageKey: "errors.scrollAreaProtocol",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "InvalidScrollAreaCleanupResponse",
    }),
  );
}
