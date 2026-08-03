import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import { ArtifactMetadataSchema, type ArtifactMetadata } from "@shared/contracts/artifact";
import {
  CaptureJobSchema,
  CaptureSettingsSchema,
  RectSchema,
  type CaptureJob,
  type CaptureSettings,
} from "@shared/contracts/domain";
import {
  WebCapErrorDataSchema,
  createWebCapError,
  type WebCapErrorData,
} from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

const IdentifierSchema = z.string().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

export const PdfEditorPageSchema = z
  .object({
    id: IdentifierSchema,
    originalIndex: NonNegativeIntegerSchema,
    sourceRectCss: RectSchema,
    pageWidthPt: z.number().finite().positive(),
    pageHeightPt: z.number().finite().positive(),
    imageRectPt: RectSchema,
  })
  .strict();

export const PdfEditManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: IdentifierSchema,
    revision: NonNegativeIntegerSchema,
    settings: CaptureSettingsSchema.shape.pdf,
    pages: z.array(PdfEditorPageSchema).min(1).max(2_000),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

export const PdfEditorEstimateSchema = z
  .object({
    approximate: z.literal(true),
    sourceBytes: NonNegativeIntegerSchema,
    estimatedBytes: PositiveIntegerSchema,
  })
  .strict();

export const PdfEditorSnapshotSchema = z
  .object({
    job: CaptureJobSchema,
    manifest: PdfEditManifestSchema,
    estimate: PdfEditorEstimateSchema,
  })
  .strict();

const EnvelopeBaseSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("editor"),
    target: z.literal("pdf-editor-background"),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const PdfEditorGetMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("PDF_EDITOR_GET"),
  payload: z.object({ jobId: IdentifierSchema }).strict(),
}).strict();

export const PdfEditorThumbnailGetMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("PDF_EDITOR_THUMBNAIL_GET"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      manifestRevision: NonNegativeIntegerSchema,
      pageId: IdentifierSchema,
    })
    .strict(),
}).strict();

export const PdfEditorUpdateActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("settings"),
      settings: CaptureSettingsSchema.shape.pdf,
    })
    .strict(),
  z
    .object({
      kind: z.literal("pages"),
      pageIds: z.array(IdentifierSchema).min(1).max(2_000),
    })
    .strict(),
]);

export const PdfEditorUpdateMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("PDF_EDITOR_UPDATE"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      expectedRevision: NonNegativeIntegerSchema,
      action: PdfEditorUpdateActionSchema,
    })
    .strict(),
}).strict();

export const PdfExportCancelMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("PDF_EXPORT_CANCEL"),
  payload: z.object({ jobId: IdentifierSchema }).strict(),
}).strict();

export const PdfEditorResponseMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("editor"),
    type: z.literal("PDF_EDITOR_RESPONSE"),
    payload: PdfEditorSnapshotSchema,
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const PdfEditorThumbnailResponseMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("editor"),
    type: z.literal("PDF_EDITOR_THUMBNAIL_RESPONSE"),
    payload: ArtifactMetadataSchema,
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const PdfEditorErrorMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("editor"),
    type: z.literal("PDF_EDITOR_ERROR"),
    payload: WebCapErrorDataSchema,
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const PdfEditorRequestSchema = z.discriminatedUnion("type", [
  PdfEditorGetMessageSchema,
  PdfEditorThumbnailGetMessageSchema,
  PdfEditorUpdateMessageSchema,
  PdfExportCancelMessageSchema,
]);

export type PdfEditorPage = z.infer<typeof PdfEditorPageSchema>;
export type PdfEditManifest = z.infer<typeof PdfEditManifestSchema>;
export type PdfEditorEstimate = z.infer<typeof PdfEditorEstimateSchema>;
export type PdfEditorSnapshot = z.infer<typeof PdfEditorSnapshotSchema>;
export type PdfEditorUpdateAction = z.infer<typeof PdfEditorUpdateActionSchema>;
export type PdfEditorGetMessage = z.infer<typeof PdfEditorGetMessageSchema>;
export type PdfEditorThumbnailGetMessage = z.infer<typeof PdfEditorThumbnailGetMessageSchema>;
export type PdfEditorUpdateMessage = z.infer<typeof PdfEditorUpdateMessageSchema>;
export type PdfExportCancelMessage = z.infer<typeof PdfExportCancelMessageSchema>;
export type PdfEditorResponseMessage = z.infer<typeof PdfEditorResponseMessageSchema>;
export type PdfEditorThumbnailResponseMessage = z.infer<
  typeof PdfEditorThumbnailResponseMessageSchema
>;
export type PdfEditorErrorMessage = z.infer<typeof PdfEditorErrorMessageSchema>;
export type PdfEditorRequest = z.infer<typeof PdfEditorRequestSchema>;

interface MessageOptions {
  requestId: string;
  sentAt: string;
}

export function createPdfEditorGetMessage(
  options: MessageOptions & { jobId: string },
): PdfEditorGetMessage {
  return PdfEditorGetMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "editor",
    target: "pdf-editor-background",
    type: "PDF_EDITOR_GET",
    payload: { jobId: options.jobId },
    sentAt: options.sentAt,
  });
}

export function createPdfEditorThumbnailGetMessage(
  options: MessageOptions & { jobId: string; manifestRevision: number; pageId: string },
): PdfEditorThumbnailGetMessage {
  return PdfEditorThumbnailGetMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "editor",
    target: "pdf-editor-background",
    type: "PDF_EDITOR_THUMBNAIL_GET",
    payload: {
      jobId: options.jobId,
      manifestRevision: options.manifestRevision,
      pageId: options.pageId,
    },
    sentAt: options.sentAt,
  });
}

export function createPdfEditorUpdateMessage(
  options: MessageOptions & {
    jobId: string;
    expectedRevision: number;
    action: PdfEditorUpdateAction;
  },
): PdfEditorUpdateMessage {
  return PdfEditorUpdateMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "editor",
    target: "pdf-editor-background",
    type: "PDF_EDITOR_UPDATE",
    payload: {
      jobId: options.jobId,
      expectedRevision: options.expectedRevision,
      action: options.action,
    },
    sentAt: options.sentAt,
  });
}

export function createPdfExportCancelMessage(
  options: MessageOptions & { jobId: string },
): PdfExportCancelMessage {
  return PdfExportCancelMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "editor",
    target: "pdf-editor-background",
    type: "PDF_EXPORT_CANCEL",
    payload: { jobId: options.jobId },
    sentAt: options.sentAt,
  });
}

export function createPdfEditorResponseMessage(
  options: MessageOptions & { snapshot: PdfEditorSnapshot },
): PdfEditorResponseMessage {
  return PdfEditorResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "editor",
    type: "PDF_EDITOR_RESPONSE",
    payload: options.snapshot,
    sentAt: options.sentAt,
  });
}

export function createPdfEditorThumbnailResponseMessage(
  options: MessageOptions & { artifact: ArtifactMetadata },
): PdfEditorThumbnailResponseMessage {
  return PdfEditorThumbnailResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "editor",
    type: "PDF_EDITOR_THUMBNAIL_RESPONSE",
    payload: options.artifact,
    sentAt: options.sentAt,
  });
}

export function createPdfEditorErrorMessage(
  options: MessageOptions & { error: WebCapErrorData },
): PdfEditorErrorMessage {
  return PdfEditorErrorMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "editor",
    type: "PDF_EDITOR_ERROR",
    payload: options.error,
    sentAt: options.sentAt,
  });
}

export function parsePdfEditorRequest(value: unknown): Result<PdfEditorRequest, WebCapErrorData> {
  const parsed = PdfEditorRequestSchema.safeParse(value);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "PDF editor message does not match a supported schema.",
      userMessageKey: "errors.protocolMessage",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "InvalidPdfEditorMessage",
    }),
  );
}

export function isPdfEditorMessageType(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "PDF_EDITOR_GET" ||
    type === "PDF_EDITOR_THUMBNAIL_GET" ||
    type === "PDF_EDITOR_UPDATE" ||
    type === "PDF_EXPORT_CANCEL"
  );
}

export function isPdfEditorResponseMessage(value: unknown): value is PdfEditorResponseMessage {
  return PdfEditorResponseMessageSchema.safeParse(value).success;
}

export function isPdfEditorThumbnailGetMessage(
  value: unknown,
): value is PdfEditorThumbnailGetMessage {
  return PdfEditorThumbnailGetMessageSchema.safeParse(value).success;
}

export function isPdfEditorThumbnailResponseMessage(
  value: unknown,
): value is PdfEditorThumbnailResponseMessage {
  return PdfEditorThumbnailResponseMessageSchema.safeParse(value).success;
}

export function isPdfEditorErrorMessage(value: unknown): value is PdfEditorErrorMessage {
  return PdfEditorErrorMessageSchema.safeParse(value).success;
}

export type PdfEditorJob = CaptureJob;
export type PdfEditorSettings = CaptureSettings["pdf"];
