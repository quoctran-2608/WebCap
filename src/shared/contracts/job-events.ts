import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import { JobSummarySchema, type JobSummary } from "@shared/contracts/job";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const JobSummaryChangedEventSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    source: z.literal("background"),
    target: z.literal("popup"),
    type: z.literal("JOB_SUMMARY_CHANGED"),
    payload: z.object({ summary: JobSummarySchema }).strict(),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export type JobSummaryChangedEvent = z.infer<typeof JobSummaryChangedEventSchema>;

export function createJobSummaryChangedEvent(options: {
  summary: JobSummary;
  sentAt: string;
}): JobSummaryChangedEvent {
  return JobSummaryChangedEventSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    source: "background",
    target: "popup",
    type: "JOB_SUMMARY_CHANGED",
    payload: { summary: options.summary },
    sentAt: options.sentAt,
  });
}

export function isJobSummaryChangedEvent(value: unknown): value is JobSummaryChangedEvent {
  return JobSummaryChangedEventSchema.safeParse(value).success;
}
