import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import {
  CaptureEngineKindSchema,
  CaptureJobSchema,
  CaptureModeSchema,
  CaptureSettingsSchema,
  type CaptureEngineKind,
  type CaptureJob,
  type CaptureMode,
  type CaptureSettings,
} from "@shared/contracts/domain";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

const IdentifierSchema = z.string().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const EnvelopeBaseSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("popup"),
    target: z.literal("background"),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const JobCreateMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("JOB_CREATE"),
  payload: z
    .object({
      tabId: NonNegativeIntegerSchema,
      windowId: NonNegativeIntegerSchema,
      mode: CaptureModeSchema,
      settings: CaptureSettingsSchema,
      preferredEngine: CaptureEngineKindSchema.optional(),
      source: z
        .object({
          title: z.string().max(300).optional(),
          origin: z.string().max(500).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
}).strict();

export const JobGetMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("JOB_GET"),
  payload: z.object({ jobId: IdentifierSchema }).strict(),
}).strict();

export const JobCancelMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("JOB_CANCEL"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      reason: z.string().min(1).max(300).optional(),
    })
    .strict(),
}).strict();

export const JobResponseMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("popup"),
    type: z.literal("JOB_RESPONSE"),
    payload: z.object({ job: CaptureJobSchema }).strict(),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const PersistentJobRequestSchema = z.discriminatedUnion("type", [
  JobCreateMessageSchema,
  JobGetMessageSchema,
  JobCancelMessageSchema,
]);

export type JobCreateMessage = z.infer<typeof JobCreateMessageSchema>;
export type JobGetMessage = z.infer<typeof JobGetMessageSchema>;
export type JobCancelMessage = z.infer<typeof JobCancelMessageSchema>;
export type JobResponseMessage = z.infer<typeof JobResponseMessageSchema>;
export type PersistentJobRequest = z.infer<typeof PersistentJobRequestSchema>;

export interface JobMessageCreationOptions {
  requestId: string;
  sentAt: string;
}

export function createJobCreateMessage(
  options: JobMessageCreationOptions & {
    tabId: number;
    windowId: number;
    mode: CaptureMode;
    settings: CaptureSettings;
    preferredEngine?: CaptureEngineKind;
    source?: { title?: string; origin?: string };
  },
): JobCreateMessage {
  return JobCreateMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "JOB_CREATE",
    payload: {
      tabId: options.tabId,
      windowId: options.windowId,
      mode: options.mode,
      settings: options.settings,
      ...(options.preferredEngine === undefined
        ? {}
        : { preferredEngine: options.preferredEngine }),
      ...(options.source === undefined ? {} : { source: options.source }),
    },
    sentAt: options.sentAt,
  });
}

export function createJobGetMessage(
  options: JobMessageCreationOptions & { jobId: string },
): JobGetMessage {
  return JobGetMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "JOB_GET",
    payload: { jobId: options.jobId },
    sentAt: options.sentAt,
  });
}

export function createJobCancelMessage(
  options: JobMessageCreationOptions & { jobId: string; reason?: string },
): JobCancelMessage {
  return JobCancelMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "JOB_CANCEL",
    payload: {
      jobId: options.jobId,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
    },
    sentAt: options.sentAt,
  });
}

export function createJobResponseMessage(
  options: JobMessageCreationOptions & { job: CaptureJob },
): JobResponseMessage {
  return JobResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "JOB_RESPONSE",
    payload: { job: options.job },
    sentAt: options.sentAt,
  });
}

export function parsePersistentJobRequest(
  value: unknown,
): Result<PersistentJobRequest, WebCapErrorData> {
  const parsed = PersistentJobRequestSchema.safeParse(value);
  if (parsed.success) {
    return ok(parsed.data);
  }

  const protocolVersion =
    typeof value === "object" && value !== null && "protocolVersion" in value
      ? (value as { protocolVersion?: unknown }).protocolVersion
      : undefined;
  return err(
    createWebCapError({
      code: protocolVersion === PROTOCOL_VERSION ? "E_PROTOCOL_MESSAGE" : "E_PROTOCOL_VERSION",
      stage: "protocol",
      message:
        protocolVersion === PROTOCOL_VERSION
          ? "Persistent job message does not match a supported schema."
          : "Persistent job message uses an unsupported protocol version.",
      userMessageKey:
        protocolVersion === PROTOCOL_VERSION
          ? "errors.protocolMessage"
          : "errors.protocolVersion",
      retryable: false,
      fallbackAllowed: false,
    }),
  );
}

export function isPersistentJobRequest(value: unknown): value is PersistentJobRequest {
  return PersistentJobRequestSchema.safeParse(value).success;
}

export function isJobResponseMessage(value: unknown): value is JobResponseMessage {
  return JobResponseMessageSchema.safeParse(value).success;
}
