import { z } from "zod";

import {
  DEDUPE_RECORD_SCHEMA_VERSION,
  JOB_SESSION_SCHEMA_VERSION,
  TILE_RECORD_SCHEMA_VERSION,
} from "@shared/constants";
import {
  CaptureEngineKindSchema,
  CaptureJobSchema,
  PartialCaptureReasonSchema,
  CaptureTileSchema,
  JobStateSchema,
  type CaptureJob,
} from "@shared/contracts/domain";
import { WebCapErrorCodeSchema } from "@shared/errors/error";

const IdentifierSchema = z.string().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const JobSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: IdentifierSchema,
    tabId: NonNegativeIntegerSchema,
    mode: CaptureJobSchema.shape.mode,
    state: JobStateSchema,
    stateRevision: NonNegativeIntegerSchema,
    completedTiles: NonNegativeIntegerSchema,
    totalTiles: NonNegativeIntegerSchema,
    completedDocumentPages: NonNegativeIntegerSchema.optional(),
    totalDocumentPages: NonNegativeIntegerSchema.optional(),
    updatedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    activeEngine: CaptureEngineKindSchema.optional(),
    partialCaptureReason: PartialCaptureReasonSchema.optional(),
    errorCode: WebCapErrorCodeSchema.optional(),
    errorUserMessageKey: z.string().min(1).max(120).optional(),
  })
  .strict();

export const TabJobLockSchema = z
  .object({
    schemaVersion: z.literal(1),
    tabId: NonNegativeIntegerSchema,
    jobId: IdentifierSchema,
    acquiredAt: IsoDateTimeSchema,
    leaseExpiresAt: IsoDateTimeSchema,
  })
  .strict();

export const JobSessionStateSchema = z
  .object({
    schemaVersion: z.literal(JOB_SESSION_SCHEMA_VERSION),
    summaries: z.array(JobSummarySchema),
    locks: z.array(TabJobLockSchema),
  })
  .strict();

export const StoredTileRecordSchema = z
  .object({
    schemaVersion: z.literal(TILE_RECORD_SCHEMA_VERSION),
    jobId: IdentifierSchema,
    index: NonNegativeIntegerSchema,
    tile: CaptureTileSchema,
    blob: z.instanceof(Blob).optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.tile.jobId !== record.jobId) {
      context.addIssue({
        code: "custom",
        message: "Stored tile jobId must match tile.jobId.",
        path: ["tile", "jobId"],
      });
    }
    if (record.tile.index !== record.index) {
      context.addIssue({
        code: "custom",
        message: "Stored tile index must match tile.index.",
        path: ["tile", "index"],
      });
    }
  });

export const StoredDedupeRecordSchema = z
  .object({
    schemaVersion: z.literal(DEDUPE_RECORD_SCHEMA_VERSION),
    requestId: IdentifierSchema,
    requestType: z.string().min(1).max(120),
    jobId: IdentifierSchema.optional(),
    response: z.unknown(),
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

export type JobSummary = z.infer<typeof JobSummarySchema>;
export type TabJobLock = z.infer<typeof TabJobLockSchema>;
export type JobSessionState = z.infer<typeof JobSessionStateSchema>;
export type StoredTileRecord = z.infer<typeof StoredTileRecordSchema>;
export type StoredDedupeRecord = z.infer<typeof StoredDedupeRecordSchema>;

export interface DocumentPageProgress {
  completed: number;
  total: number;
}

export function documentPageProgress(job: CaptureJob): DocumentPageProgress | undefined {
  const pageMap = job.documentPageMap;
  if (pageMap === undefined) return undefined;
  const storedRects = job.tilePlan
    .filter((tile) => tile.status === "stored")
    .map((tile) => tile.outputRectCss ?? tile.sourceRectCss);
  const completed = pageMap.pages.filter((page) => {
    const rect = page.sourceRectCss;
    const epsilon = 0.01;
    const points = [
      { x: rect.x + epsilon, y: rect.y + epsilon },
      { x: rect.x + rect.width - epsilon, y: rect.y + epsilon },
      { x: rect.x + epsilon, y: rect.y + rect.height - epsilon },
      { x: rect.x + rect.width - epsilon, y: rect.y + rect.height - epsilon },
    ];
    return points.every((point) =>
      storedRects.some(
        (stored) =>
          point.x >= stored.x - epsilon &&
          point.y >= stored.y - epsilon &&
          point.x <= stored.x + stored.width + epsilon &&
          point.y <= stored.y + stored.height + epsilon,
      ),
    );
  }).length;
  return { completed, total: pageMap.sourcePageCount };
}

export function summarizeJob(job: CaptureJob): JobSummary {
  const pageProgress = documentPageProgress(job);
  return JobSummarySchema.parse({
    schemaVersion: 1,
    jobId: job.id,
    tabId: job.tabId,
    mode: job.mode,
    state: job.state,
    stateRevision: job.stateRevision,
    completedTiles: job.completedTiles,
    totalTiles: job.totalTiles,
    ...(pageProgress === undefined
      ? {}
      : {
          completedDocumentPages: pageProgress.completed,
          totalDocumentPages: pageProgress.total,
        }),
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),
    ...(job.partialCapture === undefined
      ? {}
      : { partialCaptureReason: job.partialCapture.reason }),
    ...(job.error === undefined
      ? {}
      : {
          errorCode: job.error.code,
          errorUserMessageKey: job.error.userMessageKey,
        }),
  });
}
