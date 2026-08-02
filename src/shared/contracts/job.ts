import { z } from "zod";

import {
  DEDUPE_RECORD_SCHEMA_VERSION,
  JOB_SESSION_SCHEMA_VERSION,
  TILE_RECORD_SCHEMA_VERSION,
} from "@shared/constants";
import {
  CaptureEngineKindSchema,
  CaptureJobSchema,
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
    updatedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    activeEngine: CaptureEngineKindSchema.optional(),
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

export function summarizeJob(job: CaptureJob): JobSummary {
  return JobSummarySchema.parse({
    schemaVersion: 1,
    jobId: job.id,
    tabId: job.tabId,
    mode: job.mode,
    state: job.state,
    stateRevision: job.stateRevision,
    completedTiles: job.completedTiles,
    totalTiles: job.totalTiles,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    ...(job.activeEngine === undefined ? {} : { activeEngine: job.activeEngine }),
    ...(job.error === undefined
      ? {}
      : {
          errorCode: job.error.code,
          errorUserMessageKey: job.error.userMessageKey,
        }),
  });
}
