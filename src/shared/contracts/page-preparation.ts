import { z } from "zod";

import {
  DEFAULT_LAZY_LOAD_MAX_DURATION_MS,
  DEFAULT_LAZY_LOAD_SETTLE_MS,
  DEFAULT_LAZY_LOAD_STEP_RATIO,
  DEFAULT_MAX_CSS_HEIGHT,
  PROTOCOL_VERSION,
} from "@shared/constants";
import { WebCapErrorDataSchema } from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

export const PAGE_PREPARATION_SNAPSHOT_VERSION = 1 as const;

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const RequestIdSchema = z.string().min(1).max(160);
const PreparationIdSchema = z.string().min(1).max(160);
const FiniteNonNegativeSchema = z.number().finite().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

export const PagePreparationOptionsSchema = z
  .object({
    targetStartX: FiniteNonNegativeSchema.default(0),
    targetStartY: FiniteNonNegativeSchema.default(0),
    maxCssHeight: z.number().finite().positive().default(DEFAULT_MAX_CSS_HEIGHT),
    lazyLoad: z
      .object({
        enabled: z.boolean().default(true),
        stepRatio: z
          .number()
          .finite()
          .min(0.1)
          .max(1)
          .default(DEFAULT_LAZY_LOAD_STEP_RATIO),
        settleMs: z
          .number()
          .int()
          .min(0)
          .max(5_000)
          .default(DEFAULT_LAZY_LOAD_SETTLE_MS),
        maxDurationMs: z
          .number()
          .int()
          .min(100)
          .max(60_000)
          .default(DEFAULT_LAZY_LOAD_MAX_DURATION_MS),
      })
      .strict(),
  })
  .strict();

export const ScrollPointSchema = z
  .object({
    x: FiniteNonNegativeSchema,
    y: FiniteNonNegativeSchema,
  })
  .strict();

export const PagePreparationReadyPayloadSchema = z
  .object({
    preparationId: PreparationIdSchema,
    snapshotVersion: z.literal(PAGE_PREPARATION_SNAPSHOT_VERSION),
    originalScroll: ScrollPointSchema,
    preparedScroll: ScrollPointSchema,
    documentWidth: z.number().finite().positive(),
    documentHeight: z.number().finite().positive(),
    reachedLimit: z.boolean(),
    stableSamples: z.number().int().nonnegative(),
    mutationCount: z.number().int().nonnegative(),
    modifiedNodeCount: z.number().int().nonnegative(),
  })
  .strict();

export const PagePreparationCleanupReportSchema = z
  .object({
    preparationId: PreparationIdSchema,
    attempted: z.literal(true),
    completed: z.boolean(),
    restoredProperties: z.number().int().nonnegative(),
    skippedChangedProperties: z.number().int().nonnegative(),
    missingNodes: z.number().int().nonnegative(),
    residualMutations: z.number().int().nonnegative(),
    styleRemoved: z.boolean(),
    scrollRestored: z.boolean(),
    focusRestored: z.boolean(),
    errors: z.number().int().nonnegative(),
  })
  .strict();

const ContentRequestEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  source: z.literal("background"),
  target: z.literal("content"),
  sentAt: IsoDateTimeSchema,
});

const ContentResponseEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  source: z.literal("content"),
  target: z.literal("background"),
  sentAt: IsoDateTimeSchema,
});

export const PagePreparationPrepareMessageSchema = ContentRequestEnvelopeSchema.extend({
  type: z.literal("PAGE_PREPARATION_PREPARE"),
  payload: z
    .object({
      preparationId: PreparationIdSchema,
      options: PagePreparationOptionsSchema,
    })
    .strict(),
}).strict();

export const PagePreparationRestoreMessageSchema = ContentRequestEnvelopeSchema.extend({
  type: z.literal("PAGE_PREPARATION_RESTORE"),
  payload: z.object({ preparationId: PreparationIdSchema }).strict(),
}).strict();

export const PagePreparationCancelMessageSchema = ContentRequestEnvelopeSchema.extend({
  type: z.literal("PAGE_PREPARATION_CANCEL"),
  payload: z.object({ preparationId: PreparationIdSchema }).strict(),
}).strict();

export const PagePreparationReadyMessageSchema = ContentResponseEnvelopeSchema.extend({
  type: z.literal("PAGE_PREPARATION_READY"),
  payload: PagePreparationReadyPayloadSchema,
}).strict();

export const PagePreparationRestoredMessageSchema = ContentResponseEnvelopeSchema.extend({
  type: z.literal("PAGE_PREPARATION_RESTORED"),
  payload: PagePreparationCleanupReportSchema,
}).strict();

export const PagePreparationCancelledMessageSchema = ContentResponseEnvelopeSchema.extend({
  type: z.literal("PAGE_PREPARATION_CANCELLED"),
  payload: z
    .object({
      preparationId: PreparationIdSchema,
      accepted: z.boolean(),
    })
    .strict(),
}).strict();

export const PagePreparationErrorMessageSchema = ContentResponseEnvelopeSchema.extend({
  type: z.literal("PAGE_PREPARATION_ERROR"),
  payload: WebCapErrorDataSchema,
}).strict();

export const PagePreparationRequestSchema = z.discriminatedUnion("type", [
  PagePreparationPrepareMessageSchema,
  PagePreparationRestoreMessageSchema,
  PagePreparationCancelMessageSchema,
]);

export const PagePreparationResponseSchema = z.discriminatedUnion("type", [
  PagePreparationReadyMessageSchema,
  PagePreparationRestoredMessageSchema,
  PagePreparationCancelledMessageSchema,
  PagePreparationErrorMessageSchema,
]);

export type PagePreparationOptions = z.infer<typeof PagePreparationOptionsSchema>;
export type PagePreparationReadyPayload = z.infer<
  typeof PagePreparationReadyPayloadSchema
>;
export type PagePreparationCleanupReport = z.infer<
  typeof PagePreparationCleanupReportSchema
>;
export type PagePreparationPrepareMessage = z.infer<
  typeof PagePreparationPrepareMessageSchema
>;
export type PagePreparationRestoreMessage = z.infer<
  typeof PagePreparationRestoreMessageSchema
>;
export type PagePreparationCancelMessage = z.infer<
  typeof PagePreparationCancelMessageSchema
>;
export type PagePreparationReadyMessage = z.infer<typeof PagePreparationReadyMessageSchema>;
export type PagePreparationRestoredMessage = z.infer<
  typeof PagePreparationRestoredMessageSchema
>;
export type PagePreparationCancelledMessage = z.infer<
  typeof PagePreparationCancelledMessageSchema
>;
export type PagePreparationErrorMessage = z.infer<typeof PagePreparationErrorMessageSchema>;
export type PagePreparationRequest = z.infer<typeof PagePreparationRequestSchema>;
export type PagePreparationResponse = z.infer<typeof PagePreparationResponseSchema>;

export interface PagePreparationMessageOptions {
  requestId: string;
  preparationId: string;
  sentAt: string;
}

export function createPagePreparationPrepareMessage(
  options: PagePreparationMessageOptions & { preparationOptions?: Partial<PagePreparationOptions> },
): PagePreparationPrepareMessage {
  const preparationOptions = PagePreparationOptionsSchema.parse(options.preparationOptions ?? {});
  return PagePreparationPrepareMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "PAGE_PREPARATION_PREPARE",
    payload: {
      preparationId: options.preparationId,
      options: preparationOptions,
    },
    sentAt: options.sentAt,
  });
}

export function createPagePreparationRestoreMessage(
  options: PagePreparationMessageOptions,
): PagePreparationRestoreMessage {
  return PagePreparationRestoreMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "PAGE_PREPARATION_RESTORE",
    payload: { preparationId: options.preparationId },
    sentAt: options.sentAt,
  });
}

export function createPagePreparationCancelMessage(
  options: PagePreparationMessageOptions,
): PagePreparationCancelMessage {
  return PagePreparationCancelMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "PAGE_PREPARATION_CANCEL",
    payload: { preparationId: options.preparationId },
    sentAt: options.sentAt,
  });
}

export function parsePagePreparationResponse(
  value: unknown,
  expectedRequestId: string,
): Result<PagePreparationResponse, ReturnType<typeof protocolError>> {
  const parsed = PagePreparationResponseSchema.safeParse(value);
  if (!parsed.success) {
    return err(protocolError("The content script returned an invalid response.", "InvalidResponse"));
  }
  if (parsed.data.requestId !== expectedRequestId) {
    return err(
      protocolError("The content script response request ID did not match.", "RequestIdMismatch"),
    );
  }
  return ok(parsed.data);
}

function protocolError(message: string, causeCode: string) {
  return {
    code: "E_PROTOCOL_MESSAGE" as const,
    stage: "protocol" as const,
    message,
    userMessageKey: "errors.pagePreparationProtocol",
    retryable: false,
    fallbackAllowed: false,
    causeCode,
  };
}

export const DEFAULT_PAGE_PREPARATION_OPTIONS: PagePreparationOptions =
  PagePreparationOptionsSchema.parse({});

export const PAGE_PREPARATION_CONTENT_SCRIPT_FILE = "content-script.js" as const;
export const PAGE_PREPARATION_MAX_COMPLETED_REPORTS = PositiveIntegerSchema.parse(8);
