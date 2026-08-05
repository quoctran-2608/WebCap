import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import {
  WebCapErrorDataSchema,
  createWebCapError,
  type WebCapErrorData,
} from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

const IdentifierSchema = z.string().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const CaptureResetScopeSchema = z.enum(["visible-session", "job", "tab"]);
export type CaptureResetScope = z.infer<typeof CaptureResetScopeSchema>;

const CaptureResetPayloadSchema = z.discriminatedUnion("scope", [
  z
    .object({
      scope: z.literal("visible-session"),
      disposition: z.literal("discard-local-data"),
    })
    .strict(),
  z
    .object({
      scope: z.literal("job"),
      jobId: IdentifierSchema,
      disposition: z.literal("discard-local-data"),
    })
    .strict(),
  z
    .object({
      scope: z.literal("tab"),
      tabId: NonNegativeIntegerSchema,
      disposition: z.literal("discard-local-data"),
    })
    .strict(),
]);

export const CaptureResetRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.enum(["popup", "editor"]),
    target: z.literal("background"),
    type: z.literal("CAPTURE_RESET"),
    payload: CaptureResetPayloadSchema,
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const CaptureResetReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: CaptureResetScopeSchema,
    jobId: IdentifierSchema.optional(),
    tabId: NonNegativeIntegerSchema.optional(),
    cancellationAttempted: z.boolean(),
    cancellationCompleted: z.boolean(),
    deletedJobs: NonNegativeIntegerSchema,
    deletedTiles: NonNegativeIntegerSchema,
    deletedArtifacts: NonNegativeIntegerSchema,
    deletedManifests: NonNegativeIntegerSchema,
    clearedSessions: NonNegativeIntegerSchema,
    warning: WebCapErrorDataSchema.optional(),
  })
  .strict();

export const CaptureResetResponseSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.enum(["popup", "editor"]),
    type: z.literal("CAPTURE_RESET_RESPONSE"),
    payload: CaptureResetReportSchema,
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export type CaptureResetRequest = z.infer<typeof CaptureResetRequestSchema>;
export type CaptureResetReport = z.infer<typeof CaptureResetReportSchema>;
export type CaptureResetResponse = z.infer<typeof CaptureResetResponseSchema>;

export function createCaptureResetRequest(options: {
  requestId: string;
  sentAt: string;
  source?: "popup" | "editor";
  scope: "visible-session";
}): CaptureResetRequest;
export function createCaptureResetRequest(options: {
  requestId: string;
  sentAt: string;
  source?: "popup" | "editor";
  scope: "job";
  jobId: string;
}): CaptureResetRequest;
export function createCaptureResetRequest(options: {
  requestId: string;
  sentAt: string;
  source?: "popup" | "editor";
  scope: "tab";
  tabId: number;
}): CaptureResetRequest;
export function createCaptureResetRequest(options: {
  requestId: string;
  sentAt: string;
  source?: "popup" | "editor";
  scope: CaptureResetScope;
  jobId?: string;
  tabId?: number;
}): CaptureResetRequest {
  return CaptureResetRequestSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: options.source ?? "popup",
    target: "background",
    type: "CAPTURE_RESET",
    payload:
      options.scope === "job"
        ? { scope: "job", jobId: options.jobId, disposition: "discard-local-data" }
        : options.scope === "tab"
          ? { scope: "tab", tabId: options.tabId, disposition: "discard-local-data" }
          : { scope: "visible-session", disposition: "discard-local-data" },
    sentAt: options.sentAt,
  });
}

export function createCaptureResetResponse(options: {
  requestId: string;
  target: "popup" | "editor";
  report: CaptureResetReport;
  sentAt: string;
}): CaptureResetResponse {
  return CaptureResetResponseSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: options.target,
    type: "CAPTURE_RESET_RESPONSE",
    payload: options.report,
    sentAt: options.sentAt,
  });
}

export function parseCaptureResetRequest(
  value: unknown,
): Result<CaptureResetRequest, WebCapErrorData> {
  const parsed = CaptureResetRequestSchema.safeParse(value);
  if (parsed.success) return ok(parsed.data);

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
          ? "Capture reset message does not match a supported schema."
          : "Capture reset message uses an unsupported protocol version.",
      userMessageKey:
        protocolVersion === PROTOCOL_VERSION ? "errors.protocolMessage" : "errors.protocolVersion",
      retryable: false,
      fallbackAllowed: false,
    }),
  );
}

export function isCaptureResetRequest(value: unknown): value is CaptureResetRequest {
  return CaptureResetRequestSchema.safeParse(value).success;
}

export function isCaptureResetResponse(value: unknown): value is CaptureResetResponse {
  return CaptureResetResponseSchema.safeParse(value).success;
}

export function isCaptureResetMessageType(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type?: unknown }).type === "CAPTURE_RESET"
  );
}
