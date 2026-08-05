import { z } from "zod";

export const WebCapErrorCodeSchema = z.enum([
  "E_PERMISSION_DENIED",
  "E_UNSUPPORTED_URL",
  "E_TAB_NOT_ACTIVE",
  "E_DEBUGGER_ATTACH",
  "E_DEBUGGER_DETACHED",
  "E_CDP_COMMAND",
  "E_LAYOUT_UNSTABLE",
  "E_TARGET_STALE",
  "E_TILE_PLAN",
  "E_CAPTURE_RATE_LIMIT",
  "E_CAPTURE_EMPTY",
  "E_STORAGE_QUOTA",
  "E_STORAGE_READ",
  "E_STORAGE_WRITE",
  "E_SETTINGS_INVALID",
  "E_MEMORY_GUARD",
  "E_OFFSCREEN_UNAVAILABLE",
  "E_EXPORT_FAILED",
  "E_IMAGE_OUTPUT_TOO_LARGE",
  "E_DOWNLOAD_FAILED",
  "E_CANCELLED",
  "E_CLEANUP_PARTIAL",
  "E_PROTOCOL_VERSION",
  "E_PROTOCOL_MESSAGE",
  "E_UNKNOWN",
]);

export const ErrorStageSchema = z.enum([
  "permission",
  "prepare",
  "measure",
  "plan",
  "capture",
  "process",
  "export",
  "cleanup",
  "storage",
  "protocol",
]);

const SafeContextValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const WebCapErrorDataSchema = z
  .object({
    code: WebCapErrorCodeSchema,
    stage: ErrorStageSchema,
    message: z.string().min(1).max(500),
    userMessageKey: z.string().min(1).max(120),
    retryable: z.boolean(),
    fallbackAllowed: z.boolean(),
    safeContext: z.record(z.string(), SafeContextValueSchema).optional(),
    causeCode: z.string().min(1).max(120).optional(),
  })
  .strict();

export type WebCapErrorCode = z.infer<typeof WebCapErrorCodeSchema>;
export type ErrorStage = z.infer<typeof ErrorStageSchema>;
export type WebCapErrorData = z.infer<typeof WebCapErrorDataSchema>;

export interface CreateWebCapErrorOptions {
  code: WebCapErrorCode;
  stage: ErrorStage;
  message: string;
  userMessageKey: string;
  retryable?: boolean;
  fallbackAllowed?: boolean;
  safeContext?: Record<string, string | number | boolean>;
  causeCode?: string;
}

export function createWebCapError(options: CreateWebCapErrorOptions): WebCapErrorData {
  return WebCapErrorDataSchema.parse({
    code: options.code,
    stage: options.stage,
    message: options.message,
    userMessageKey: options.userMessageKey,
    retryable: options.retryable ?? false,
    fallbackAllowed: options.fallbackAllowed ?? false,
    ...(options.safeContext === undefined ? {} : { safeContext: options.safeContext }),
    ...(options.causeCode === undefined ? {} : { causeCode: options.causeCode }),
  });
}

export class WebCapRuntimeError extends Error {
  readonly data: WebCapErrorData;
  readonly code: WebCapErrorCode;
  readonly stage: ErrorStage;
  readonly userMessageKey: string;
  readonly retryable: boolean;
  readonly fallbackAllowed: boolean;

  constructor(data: WebCapErrorData) {
    super(data.message);
    this.name = data.code;
    this.data = data;
    this.code = data.code;
    this.stage = data.stage;
    this.userMessageKey = data.userMessageKey;
    this.retryable = data.retryable;
    this.fallbackAllowed = data.fallbackAllowed;
  }
}

export function createWebCapRuntimeError(data: WebCapErrorData): WebCapRuntimeError {
  return new WebCapRuntimeError(data);
}
