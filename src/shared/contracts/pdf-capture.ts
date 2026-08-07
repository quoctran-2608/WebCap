import { z } from "zod";

import { RectSchema } from "@shared/contracts/domain";
import { WebCapErrorDataSchema } from "@shared/errors/error";

const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();
const PositiveFiniteNumberSchema = z.number().finite().positive();
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const PdfCaptureStrategySchema = z.enum([
  "original-source",
  "semantic-viewer",
  "visual-discovery",
]);

export const PdfManifestStateSchema = z.enum([
  "created",
  "negotiating",
  "discovering",
  "capturing",
  "verifying",
  "writing",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const PdfPageLifecycleStateSchema = z.enum([
  "discovered",
  "capturing",
  "captured",
  "verified",
  "written",
]);

export const PdfOutputStateSchema = z.enum([
  "not-started",
  "writing",
  "verifying",
  "completed",
  "partial",
]);

export const PdfPageOrientationSchema = z.enum(["portrait", "landscape"]);

export const PdfPageManifestSchema = z
  .object({
    index: NonNegativeIntegerSchema,
    identity: z.string().min(1).max(200),
    sourceRectCss: RectSchema.refine((rect) => rect.width > 0 && rect.height > 0).optional(),
    widthCss: PositiveFiniteNumberSchema,
    heightCss: PositiveFiniteNumberSchema,
    orientation: PdfPageOrientationSchema,
    discoveryConfidence: z.number().finite().min(0).max(1),
    state: PdfPageLifecycleStateSchema,
    captureFingerprint: z.string().min(1).max(200).optional(),
    spoolReference: z.string().min(1).max(300).optional(),
  })
  .strict();

export const PdfPageProgressSchema = z
  .object({
    expectedPages: PositiveIntegerSchema.optional(),
    discoveredPages: NonNegativeIntegerSchema,
    capturedPages: NonNegativeIntegerSchema,
    verifiedPages: NonNegativeIntegerSchema,
    outputPages: NonNegativeIntegerSchema,
    currentPage: NonNegativeIntegerSchema.optional(),
    currentBatch: NonNegativeIntegerSchema,
  })
  .strict();

export const PdfOutputPlanSchema = z
  .object({
    kind: z.enum(["source-order", "editor"]),
    sourcePageIndexes: z.array(NonNegativeIntegerSchema).min(1),
    editRevision: NonNegativeIntegerSchema.optional(),
  })
  .strict();

export const PdfStrategyReasonSchema = z.enum([
  "original-available",
  "viewer-visible",
  "source-unavailable",
  "source-auth-required",
  "source-permission-required",
  "s27-page-map",
]);

export const PdfStrategyDecisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    primaryStrategy: PdfCaptureStrategySchema,
    fallbackStrategies: z.array(PdfCaptureStrategySchema).max(2),
    reason: PdfStrategyReasonSchema,
    canDownloadOriginal: z.boolean(),
    canCaptureViewer: z.boolean(),
  })
  .strict();

export const PdfDocumentManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: NonNegativeIntegerSchema,
    jobId: z.string().min(1).max(160),
    sourceIdentity: z.string().min(1).max(240),
    sourceStrategy: PdfCaptureStrategySchema,
    viewerAdapter: z.string().min(1).max(80),
    expectedPageCount: PositiveIntegerSchema.optional(),
    discoveryComplete: z.boolean(),
    pages: z.array(PdfPageManifestSchema),
    state: PdfManifestStateSchema,
    progress: PdfPageProgressSchema,
    outputPlan: PdfOutputPlanSchema.optional(),
    outputState: PdfOutputStateSchema,
    lastVerifiedPage: NonNegativeIntegerSchema.optional(),
    error: WebCapErrorDataSchema.optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

export const PdfCompletionEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: z.string().min(1).max(160),
    manifestRevision: NonNegativeIntegerSchema,
    sourcePageCount: PositiveIntegerSchema,
    expectedOutputPageCount: PositiveIntegerSchema,
    outputPageCount: PositiveIntegerSchema,
    verified: z.literal(true),
  })
  .strict();

export type PdfCaptureStrategy = z.infer<typeof PdfCaptureStrategySchema>;
export type PdfManifestState = z.infer<typeof PdfManifestStateSchema>;
export type PdfPageLifecycleState = z.infer<typeof PdfPageLifecycleStateSchema>;
export type PdfOutputState = z.infer<typeof PdfOutputStateSchema>;
export type PdfPageOrientation = z.infer<typeof PdfPageOrientationSchema>;
export type PdfPageManifest = z.infer<typeof PdfPageManifestSchema>;
export type PdfPageProgress = z.infer<typeof PdfPageProgressSchema>;
export type PdfOutputPlan = z.infer<typeof PdfOutputPlanSchema>;
export type PdfStrategyReason = z.infer<typeof PdfStrategyReasonSchema>;
export type PdfStrategyDecision = z.infer<typeof PdfStrategyDecisionSchema>;
export type PdfDocumentManifest = z.infer<typeof PdfDocumentManifestSchema>;
export type PdfCompletionEvidence = z.infer<typeof PdfCompletionEvidenceSchema>;
