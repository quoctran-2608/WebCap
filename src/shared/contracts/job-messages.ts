import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import {
  CaptureResetRequestSchema,
  type CaptureResetRequest,
} from "@shared/contracts/capture-reset";
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
import { PdfDocumentManifestSchema, type PdfDocumentManifest } from "@shared/contracts/pdf-capture";
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

export const JobGetActiveMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("JOB_GET_ACTIVE"),
  payload: z.object({ tabId: NonNegativeIntegerSchema }).strict(),
}).strict();

export const JobCancelMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("JOB_CANCEL"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      reason: z.string().min(1).max(300).optional(),
      disposition: z.enum(["discard", "keep-partial"]).default("discard"),
    })
    .strict(),
}).strict();

export const JobResumeMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("JOB_RESUME"),
  payload: z.object({ jobId: IdentifierSchema }).strict(),
}).strict();

export const PdfExportStartMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("PDF_EXPORT_START"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      settings: CaptureSettingsSchema.shape.pdf.optional(),
    })
    .strict(),
}).strict();

export const PdfManifestGetMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("PDF_MANIFEST_GET"),
  payload: z.object({ jobId: IdentifierSchema }).strict(),
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

export const JobActiveResponseMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("popup"),
    type: z.literal("JOB_ACTIVE_RESPONSE"),
    payload: z.object({ job: CaptureJobSchema.nullable() }).strict(),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const PdfManifestResponseMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("popup"),
    type: z.literal("PDF_MANIFEST_RESPONSE"),
    payload: z.object({ manifest: PdfDocumentManifestSchema.nullable() }).strict(),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const PersistentJobRequestSchema = z.discriminatedUnion("type", [
  JobCreateMessageSchema,
  JobGetMessageSchema,
  JobGetActiveMessageSchema,
  JobCancelMessageSchema,
  PdfExportStartMessageSchema,
  CaptureResetRequestSchema,
]);

export type JobCreateMessage = z.infer<typeof JobCreateMessageSchema>;
export type JobGetMessage = z.infer<typeof JobGetMessageSchema>;
export type JobGetActiveMessage = z.infer<typeof JobGetActiveMessageSchema>;
export type JobCancelMessage = z.infer<typeof JobCancelMessageSchema>;
export type JobResumeMessage = z.infer<typeof JobResumeMessageSchema>;
export type PdfExportStartMessage = z.infer<typeof PdfExportStartMessageSchema>;
export type PdfManifestGetMessage = z.infer<typeof PdfManifestGetMessageSchema>;
export type JobResponseMessage = z.infer<typeof JobResponseMessageSchema>;
export type JobActiveResponseMessage = z.infer<typeof JobActiveResponseMessageSchema>;
export type PdfManifestResponseMessage = z.infer<typeof PdfManifestResponseMessageSchema>;
export type PersistentJobRequest =
  | z.infer<typeof JobCreateMessageSchema>
  | z.infer<typeof JobGetMessageSchema>
  | z.infer<typeof JobGetActiveMessageSchema>
  | z.infer<typeof JobCancelMessageSchema>
  | z.infer<typeof PdfExportStartMessageSchema>
  | CaptureResetRequest;

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

export function createJobGetActiveMessage(
  options: JobMessageCreationOptions & { tabId: number },
): JobGetActiveMessage {
  return JobGetActiveMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "JOB_GET_ACTIVE",
    payload: { tabId: options.tabId },
    sentAt: options.sentAt,
  });
}

export function createJobCancelMessage(
  options: JobMessageCreationOptions & {
    jobId: string;
    reason?: string;
    disposition?: "discard" | "keep-partial";
  },
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
      disposition: options.disposition ?? "discard",
    },
    sentAt: options.sentAt,
  });
}

export function createJobResumeMessage(
  options: JobMessageCreationOptions & { jobId: string },
): JobResumeMessage {
  return JobResumeMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "JOB_RESUME",
    payload: { jobId: options.jobId },
    sentAt: options.sentAt,
  });
}

export function createPdfExportStartMessage(
  options: JobMessageCreationOptions & {
    jobId: string;
    settings?: CaptureSettings["pdf"];
  },
): PdfExportStartMessage {
  return PdfExportStartMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "PDF_EXPORT_START",
    payload: {
      jobId: options.jobId,
      ...(options.settings === undefined ? {} : { settings: options.settings }),
    },
    sentAt: options.sentAt,
  });
}

export function createPdfManifestGetMessage(
  options: JobMessageCreationOptions & { jobId: string },
): PdfManifestGetMessage {
  return PdfManifestGetMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "background",
    type: "PDF_MANIFEST_GET",
    payload: { jobId: options.jobId },
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

export function createJobActiveResponseMessage(
  options: JobMessageCreationOptions & { job: CaptureJob | null },
): JobActiveResponseMessage {
  return JobActiveResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "JOB_ACTIVE_RESPONSE",
    payload: { job: options.job },
    sentAt: options.sentAt,
  });
}

export function createPdfManifestResponseMessage(
  options: JobMessageCreationOptions & { manifest: PdfDocumentManifest | null },
): PdfManifestResponseMessage {
  return PdfManifestResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "PDF_MANIFEST_RESPONSE",
    payload: { manifest: options.manifest },
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
        protocolVersion === PROTOCOL_VERSION ? "errors.protocolMessage" : "errors.protocolVersion",
      retryable: false,
      fallbackAllowed: false,
    }),
  );
}

export function isPdfUxMessageType(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "PDF_MANIFEST_GET" || type === "JOB_RESUME";
}

export function isPersistentJobRequest(value: unknown): value is PersistentJobRequest {
  return PersistentJobRequestSchema.safeParse(value).success;
}

export function isJobResponseMessage(value: unknown): value is JobResponseMessage {
  return JobResponseMessageSchema.safeParse(value).success;
}

export function isJobActiveResponseMessage(value: unknown): value is JobActiveResponseMessage {
  return JobActiveResponseMessageSchema.safeParse(value).success;
}

export function isPdfManifestResponseMessage(value: unknown): value is PdfManifestResponseMessage {
  return PdfManifestResponseMessageSchema.safeParse(value).success;
}
