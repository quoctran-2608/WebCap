import { z } from "zod";

import { WebCapErrorDataSchema } from "@shared/errors/error";

const FiniteNumberSchema = z.number().finite();
const NonNegativeFiniteNumberSchema = FiniteNumberSchema.nonnegative();
const PositiveFiniteNumberSchema = FiniteNumberSchema.positive();
const PositiveIntegerSchema = z.number().int().positive();
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const CaptureModeSchema = z.enum([
  "visible",
  "full-page",
  "region",
  "element",
  "scroll-area",
]);
export const CaptureEngineKindSchema = z.enum(["cdp", "scroll"]);
export const JobStateSchema = z.enum([
  "created",
  "preparing",
  "capturing",
  "processing",
  "ready",
  "exporting",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
]);
export const FixedElementModeSchema = z.enum(["preserve", "smart", "remove"]);
export const ImageFormatSchema = z.enum(["png", "jpeg", "webp"]);
export const OutputFormatSchema = z.enum(["png", "jpeg", "webp", "pdf"]);

export const RectSchema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    width: NonNegativeFiniteNumberSchema,
    height: NonNegativeFiniteNumberSchema,
  })
  .strict();

export const ElementTargetDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    selectionId: z.string().min(1).max(160),
    tagName: z.string().min(1).max(40),
    id: z.string().min(1).max(60).optional(),
    classNames: z.array(z.string().min(1).max(40)).max(3),
    scrollable: z.boolean(),
    captureKind: z.literal("visible-bounds"),
  })
  .strict();

export const PageMetricsSchema = z
  .object({
    document: RectSchema,
    layoutViewport: RectSchema,
    visualViewport: RectSchema.extend({ scale: PositiveFiniteNumberSchema }),
    devicePixelRatio: PositiveFiniteNumberSchema,
    zoomFactor: PositiveFiniteNumberSchema,
    scrollX: FiniteNumberSchema,
    scrollY: FiniteNumberSchema,
  })
  .strict();

export const CaptureTileSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    index: NonNegativeIntegerSchema,
    row: NonNegativeIntegerSchema,
    column: NonNegativeIntegerSchema,
    sourceRectCss: RectSchema,
    outputRectCss: RectSchema.optional(),
    scrollXCss: NonNegativeFiniteNumberSchema.optional(),
    scrollYCss: NonNegativeFiniteNumberSchema.optional(),
    expectedPixelWidth: PositiveIntegerSchema,
    expectedPixelHeight: PositiveIntegerSchema,
    overlapTopCss: NonNegativeFiniteNumberSchema,
    overlapLeftCss: NonNegativeFiniteNumberSchema,
    overlapRightCss: NonNegativeFiniteNumberSchema.optional(),
    overlapBottomCss: NonNegativeFiniteNumberSchema.optional(),
    fixedElementsHidden: NonNegativeIntegerSchema.optional(),
    status: z.enum(["planned", "capturing", "stored", "failed"]),
    attempts: NonNegativeIntegerSchema,
    byteLength: NonNegativeIntegerSchema.optional(),
    mimeType: z.string().min(1).optional(),
    checksum: z.string().min(1).optional(),
  })
  .strict();

export const CaptureSettingsSchema = z
  .object({
    outputFormat: OutputFormatSchema,
    imageQuality: z.number().finite().min(0).max(1),
    fixedElementMode: FixedElementModeSchema,
    lazyLoad: z
      .object({
        enabled: z.boolean(),
        stepRatio: z.number().finite().min(0.1).max(1),
        settleMs: z.number().int().min(0).max(10_000),
        maxDurationMs: z.number().int().min(1_000).max(120_000),
      })
      .strict(),
    limits: z
      .object({
        maxCssHeight: PositiveFiniteNumberSchema,
        maxCssWidth: PositiveFiniteNumberSchema,
        maxTiles: PositiveIntegerSchema,
        maxEstimatedBytes: PositiveIntegerSchema,
      })
      .strict(),
    pdf: z
      .object({
        pageSize: z.enum(["a4", "letter", "fit-width"]),
        orientation: z.enum(["portrait", "landscape"]),
        marginMm: z.number().finite().min(0).max(50),
        jpegQuality: z.number().finite().min(0).max(1),
      })
      .strict(),
  })
  .strict();

export const CleanupStateSchema = z
  .object({
    attempted: z.boolean(),
    completed: z.boolean(),
    error: WebCapErrorDataSchema.optional(),
  })
  .strict();

export const CaptureJobSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    tabId: NonNegativeIntegerSchema,
    windowId: NonNegativeIntegerSchema,
    source: z
      .object({
        title: z.string().max(300).optional(),
        origin: z.string().max(500).optional(),
        createdAt: IsoDateTimeSchema,
      })
      .strict(),
    mode: CaptureModeSchema,
    preferredEngine: CaptureEngineKindSchema,
    activeEngine: CaptureEngineKindSchema.optional(),
    state: JobStateSchema,
    stateRevision: NonNegativeIntegerSchema,
    metrics: PageMetricsSchema.optional(),
    targetRect: RectSchema.optional(),
    targetDescriptor: ElementTargetDescriptorSchema.optional(),
    tilePlan: z.array(CaptureTileSchema),
    completedTiles: NonNegativeIntegerSchema,
    totalTiles: NonNegativeIntegerSchema,
    settings: CaptureSettingsSchema,
    cleanup: CleanupStateSchema,
    error: WebCapErrorDataSchema.optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

export type CaptureMode = z.infer<typeof CaptureModeSchema>;
export type CaptureEngineKind = z.infer<typeof CaptureEngineKindSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type FixedElementMode = z.infer<typeof FixedElementModeSchema>;
export type ImageFormat = z.infer<typeof ImageFormatSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export type Rect = z.infer<typeof RectSchema>;
export type ElementTargetDescriptor = z.infer<typeof ElementTargetDescriptorSchema>;
export type PageMetrics = z.infer<typeof PageMetricsSchema>;
export type CaptureTile = z.infer<typeof CaptureTileSchema>;
export type CaptureSettings = z.infer<typeof CaptureSettingsSchema>;
export type CleanupState = z.infer<typeof CleanupStateSchema>;
export type CaptureJob = z.infer<typeof CaptureJobSchema>;
