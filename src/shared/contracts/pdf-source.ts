import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import { ArtifactMetadataSchema } from "@shared/contracts/artifact";
import {
  WebCapErrorDataSchema,
  createWebCapError,
  type WebCapErrorData,
} from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

const RequestIdSchema = z.string().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const PdfSourceStatusSchema = z.enum([
  "not-pdf",
  "original-passthrough",
  "viewer-capture",
  "auth-required",
  "unsupported",
]);

export const PdfSourcePermissionSchema = z.enum([
  "not-required",
  "granted",
  "host-required",
  "file-access-required",
]);

export const PdfSourceReasonSchema = z.enum([
  "url-extension",
  "content-type",
  "chrome-pdf-viewer",
  "not-pdf-url",
  "unsupported-scheme",
  "permission-missing",
  "file-access-disabled",
  "auth-required",
  "fetch-failed",
  "response-not-pdf",
  "pdf-invalid",
  "redirect-permission-required",
  "downloaded-original",
]);

export const PdfSourceSignalsSchema = z
  .object({
    urlExtension: z.boolean(),
    contentType: z.boolean(),
    chromePdfViewer: z.boolean(),
    signature: z.boolean(),
  })
  .strict();

export const PdfSourceCapabilitySchema = z
  .object({
    status: PdfSourceStatusSchema,
    permission: PdfSourcePermissionSchema,
    reason: PdfSourceReasonSchema,
    tabId: NonNegativeIntegerSchema.optional(),
    scheme: z.string().min(1).max(32).optional(),
    sourceLabel: z.string().min(1).max(180).optional(),
    filename: z.string().min(1).max(180).optional(),
    permissionOrigin: z.string().min(1).max(300).optional(),
    canDownloadOriginal: z.boolean(),
    canCaptureViewer: z.boolean(),
    signals: PdfSourceSignalsSchema,
  })
  .strict();

export const PdfOriginalDownloadSchema = z
  .object({
    capability: PdfSourceCapabilitySchema,
    artifact: ArtifactMetadataSchema,
    downloadId: NonNegativeIntegerSchema,
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    originalByteLength: z.number().int().positive(),
  })
  .strict();

const PdfSourceEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: RequestIdSchema,
  sentAt: IsoDateTimeSchema,
});

export const PdfSourceInspectMessageSchema = PdfSourceEnvelopeSchema.extend({
  source: z.literal("popup"),
  target: z.literal("pdf-source-background"),
  type: z.literal("PDF_SOURCE_INSPECT"),
  payload: z.object({}).strict(),
}).strict();

export const PdfSourceInspectResponseMessageSchema = PdfSourceEnvelopeSchema.extend({
  source: z.literal("pdf-source-background"),
  target: z.literal("popup"),
  type: z.literal("PDF_SOURCE_INSPECT_RESPONSE"),
  payload: PdfSourceCapabilitySchema,
}).strict();

export const PdfSourceDownloadMessageSchema = PdfSourceEnvelopeSchema.extend({
  source: z.literal("popup"),
  target: z.literal("pdf-source-background"),
  type: z.literal("PDF_SOURCE_DOWNLOAD_ORIGINAL"),
  payload: z.object({ expectedTabId: NonNegativeIntegerSchema }).strict(),
}).strict();

export const PdfSourceDownloadResponseMessageSchema = PdfSourceEnvelopeSchema.extend({
  source: z.literal("pdf-source-background"),
  target: z.literal("popup"),
  type: z.literal("PDF_SOURCE_DOWNLOAD_RESPONSE"),
  payload: z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("downloaded"),
        result: PdfOriginalDownloadSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("fallback"),
        capability: PdfSourceCapabilitySchema,
      })
      .strict(),
  ]),
}).strict();

export const PdfSourceErrorMessageSchema = PdfSourceEnvelopeSchema.extend({
  source: z.literal("pdf-source-background"),
  target: z.literal("popup"),
  type: z.literal("PDF_SOURCE_ERROR"),
  payload: WebCapErrorDataSchema,
}).strict();

export const PdfSourceRequestSchema = z.discriminatedUnion("type", [
  PdfSourceInspectMessageSchema,
  PdfSourceDownloadMessageSchema,
]);

export type PdfSourceStatus = z.infer<typeof PdfSourceStatusSchema>;
export type PdfSourcePermission = z.infer<typeof PdfSourcePermissionSchema>;
export type PdfSourceReason = z.infer<typeof PdfSourceReasonSchema>;
export type PdfSourceSignals = z.infer<typeof PdfSourceSignalsSchema>;
export type PdfSourceCapability = z.infer<typeof PdfSourceCapabilitySchema>;
export type PdfOriginalDownload = z.infer<typeof PdfOriginalDownloadSchema>;
export type PdfSourceInspectMessage = z.infer<typeof PdfSourceInspectMessageSchema>;
export type PdfSourceInspectResponseMessage = z.infer<typeof PdfSourceInspectResponseMessageSchema>;
export type PdfSourceDownloadMessage = z.infer<typeof PdfSourceDownloadMessageSchema>;
export type PdfSourceDownloadResponseMessage = z.infer<
  typeof PdfSourceDownloadResponseMessageSchema
>;
export type PdfSourceErrorMessage = z.infer<typeof PdfSourceErrorMessageSchema>;
export type PdfSourceRequest = z.infer<typeof PdfSourceRequestSchema>;
export type PdfSourceResponse =
  PdfSourceInspectResponseMessage | PdfSourceDownloadResponseMessage | PdfSourceErrorMessage;

interface MessageOptions {
  requestId: string;
  sentAt: string;
}

export function createPdfSourceInspectMessage(options: MessageOptions): PdfSourceInspectMessage {
  return PdfSourceInspectMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "pdf-source-background",
    type: "PDF_SOURCE_INSPECT",
    payload: {},
    sentAt: options.sentAt,
  });
}

export function createPdfSourceInspectResponseMessage(
  options: MessageOptions & { capability: PdfSourceCapability },
): PdfSourceInspectResponseMessage {
  return PdfSourceInspectResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "pdf-source-background",
    target: "popup",
    type: "PDF_SOURCE_INSPECT_RESPONSE",
    payload: options.capability,
    sentAt: options.sentAt,
  });
}

export function createPdfSourceDownloadMessage(
  options: MessageOptions & { expectedTabId: number },
): PdfSourceDownloadMessage {
  return PdfSourceDownloadMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "popup",
    target: "pdf-source-background",
    type: "PDF_SOURCE_DOWNLOAD_ORIGINAL",
    payload: { expectedTabId: options.expectedTabId },
    sentAt: options.sentAt,
  });
}

export function createPdfSourceDownloadResponseMessage(
  options:
    | (MessageOptions & { status: "downloaded"; result: PdfOriginalDownload })
    | (MessageOptions & { status: "fallback"; capability: PdfSourceCapability }),
): PdfSourceDownloadResponseMessage {
  return PdfSourceDownloadResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "pdf-source-background",
    target: "popup",
    type: "PDF_SOURCE_DOWNLOAD_RESPONSE",
    payload:
      options.status === "downloaded"
        ? { status: "downloaded", result: options.result }
        : { status: "fallback", capability: options.capability },
    sentAt: options.sentAt,
  });
}

export function createPdfSourceErrorMessage(
  options: MessageOptions & { error: WebCapErrorData },
): PdfSourceErrorMessage {
  return PdfSourceErrorMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "pdf-source-background",
    target: "popup",
    type: "PDF_SOURCE_ERROR",
    payload: options.error,
    sentAt: options.sentAt,
  });
}

export function parsePdfSourceRequest(value: unknown): Result<PdfSourceRequest, WebCapErrorData> {
  const parsed = PdfSourceRequestSchema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  return err(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The PDF source request did not match the WebCap protocol.",
      userMessageKey: "errors.protocolMessage",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "PdfSourceRequestInvalid",
    }),
  );
}

export function isPdfSourceInspectResponseMessage(
  value: unknown,
): value is PdfSourceInspectResponseMessage {
  return PdfSourceInspectResponseMessageSchema.safeParse(value).success;
}

export function isPdfSourceDownloadResponseMessage(
  value: unknown,
): value is PdfSourceDownloadResponseMessage {
  return PdfSourceDownloadResponseMessageSchema.safeParse(value).success;
}

export function isPdfSourceErrorMessage(value: unknown): value is PdfSourceErrorMessage {
  return PdfSourceErrorMessageSchema.safeParse(value).success;
}

export function isPdfSourceMessageType(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === "PDF_SOURCE_INSPECT" || type === "PDF_SOURCE_DOWNLOAD_ORIGINAL";
}
