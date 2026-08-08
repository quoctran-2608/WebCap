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
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveFiniteSchema = z.number().finite().positive();

export const PdfViewerAdapterKindSchema = z.enum([
  "pdfjs",
  "generic-semantic",
  "shadow-root",
  "virtualized",
  "canvas-visual",
]);

export const PdfViewerRenderStateSchema = z.enum(["ready", "unknown", "placeholder"]);

export const PdfViewerPageCandidateSchema = z
  .object({
    rect: RectSchema,
    adapter: PdfViewerAdapterKindSchema,
    confidence: z.number().finite().min(0).max(1),
    sampleIndex: NonNegativeIntegerSchema,
    declaredIndex: NonNegativeIntegerSchema.optional(),
    renderState: PdfViewerRenderStateSchema.optional(),
  })
  .strict();

export const PdfViewerDiscoverySnapshotSchema = z
  .object({
    adapter: PdfViewerAdapterKindSchema,
    declaredPageCount: z.number().int().positive().max(10_000).optional(),
    scrollWidth: PositiveFiniteSchema,
    scrollHeight: PositiveFiniteSchema,
    clientHeight: PositiveFiniteSchema,
    reachedStart: z.boolean(),
    reachedEnd: z.boolean(),
    stableEndRounds: NonNegativeIntegerSchema,
    candidates: z.array(PdfViewerPageCandidateSchema).max(100_000),
  })
  .strict();

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

export const PdfViewerDiscoveryRequestMessageSchema = BackgroundToContentSchema.extend({
  type: z.literal("PDF_VIEWER_DISCOVERY"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      descriptor: ElementTargetDescriptorSchema.refine(
        (descriptor) => descriptor.captureKind === "full-scroll-content",
      ),
      settleMs: NonNegativeIntegerSchema,
    })
    .strict(),
}).strict();

export const PdfViewerDiscoveryResponseMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("PDF_VIEWER_DISCOVERED"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      descriptor: ElementTargetDescriptorSchema,
      snapshot: PdfViewerDiscoverySnapshotSchema,
    })
    .strict(),
}).strict();

export const PdfViewerDiscoveryErrorMessageSchema = ContentToBackgroundSchema.extend({
  type: z.literal("PDF_VIEWER_DISCOVERY_ERROR"),
  payload: WebCapErrorDataSchema,
}).strict();

export type PdfViewerAdapterKind = z.infer<typeof PdfViewerAdapterKindSchema>;
export type PdfViewerRenderState = z.infer<typeof PdfViewerRenderStateSchema>;
export type PdfViewerPageCandidate = z.infer<typeof PdfViewerPageCandidateSchema>;
export type PdfViewerDiscoverySnapshot = z.infer<typeof PdfViewerDiscoverySnapshotSchema>;
export type PdfViewerDiscoveryRequestMessage = z.infer<
  typeof PdfViewerDiscoveryRequestMessageSchema
>;
export type PdfViewerDiscoveryResponseMessage = z.infer<
  typeof PdfViewerDiscoveryResponseMessageSchema
>;

export function createPdfViewerDiscoveryRequest(options: {
  requestId: string;
  sentAt: string;
  jobId: string;
  descriptor: ElementTargetDescriptor;
  settleMs: number;
}): PdfViewerDiscoveryRequestMessage {
  return PdfViewerDiscoveryRequestMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "content",
    type: "PDF_VIEWER_DISCOVERY",
    payload: {
      jobId: options.jobId,
      descriptor: options.descriptor,
      settleMs: options.settleMs,
    },
    sentAt: options.sentAt,
  });
}

export function parsePdfViewerDiscoveryResponse(
  value: unknown,
  expectedRequestId: string,
): Result<PdfViewerDiscoveryResponseMessage, WebCapErrorData> {
  const success = PdfViewerDiscoveryResponseMessageSchema.safeParse(value);
  if (success.success && success.data.requestId === expectedRequestId) return ok(success.data);
  const failure = PdfViewerDiscoveryErrorMessageSchema.safeParse(value);
  if (failure.success && failure.data.requestId === expectedRequestId) {
    return err(failure.data.payload);
  }
  return err(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The content script returned an invalid PDF viewer discovery response.",
      userMessageKey: "errors.scrollAreaProtocol",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "PdfViewerDiscoveryProtocolInvalid",
    }),
  );
}
