import { z } from "zod";

import { CAPTURE_PROGRESS_STAGES } from "@capture/capture-engine";
import { PROTOCOL_VERSION } from "@shared/constants";
import { JobStateSchema } from "@shared/contracts/domain";

const IdentifierSchema = z.string().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const CaptureProgressStageSchema = z.enum(CAPTURE_PROGRESS_STAGES);

export const JobProgressMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("popup"),
    type: z.literal("JOB_PROGRESS"),
    payload: z
      .object({
        jobId: IdentifierSchema,
        state: JobStateSchema,
        stage: CaptureProgressStageSchema,
        completed: NonNegativeIntegerSchema,
        total: NonNegativeIntegerSchema,
        tileIndex: NonNegativeIntegerSchema.optional(),
      })
      .strict(),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export type JobProgressMessage = z.infer<typeof JobProgressMessageSchema>;

export function createJobProgressMessage(options: {
  requestId: string;
  jobId: string;
  state: z.infer<typeof JobStateSchema>;
  stage: z.infer<typeof CaptureProgressStageSchema>;
  completed: number;
  total: number;
  tileIndex?: number;
  sentAt: string;
}): JobProgressMessage {
  return JobProgressMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "popup",
    type: "JOB_PROGRESS",
    payload: {
      jobId: options.jobId,
      state: options.state,
      stage: options.stage,
      completed: options.completed,
      total: options.total,
      ...(options.tileIndex === undefined ? {} : { tileIndex: options.tileIndex }),
    },
    sentAt: options.sentAt,
  });
}

export function isJobProgressMessage(value: unknown): value is JobProgressMessage {
  return JobProgressMessageSchema.safeParse(value).success;
}
