import {
  WebCapErrorDataSchema,
  WebCapRuntimeError,
  createWebCapError,
  type ErrorStage,
  type WebCapErrorCode,
  type WebCapErrorData,
} from "./error";

export interface NormalizeErrorOptions {
  code?: WebCapErrorCode;
  stage: ErrorStage;
  userMessageKey: string;
  retryable?: boolean;
  fallbackAllowed?: boolean;
  safeContext?: Record<string, string | number | boolean>;
}

function causeCodeOf(value: unknown): string | undefined {
  if (value instanceof DOMException) {
    return value.name;
  }

  if (value instanceof Error) {
    const cause = value.cause;
    if (cause instanceof Error) {
      return cause.name;
    }
    return value.name;
  }

  return undefined;
}

function safeMessageOf(value: unknown): string {
  if (value instanceof Error && value.message.trim().length > 0) {
    return value.message.slice(0, 500);
  }

  return "An unexpected WebCap error occurred.";
}

export function normalizeError(value: unknown, options: NormalizeErrorOptions): WebCapErrorData {
  if (value instanceof WebCapRuntimeError) {
    return value.data;
  }

  const existing = WebCapErrorDataSchema.safeParse(value);
  if (existing.success) {
    return existing.data;
  }

  const causeCode = causeCodeOf(value);
  return createWebCapError({
    code: options.code ?? "E_UNKNOWN",
    stage: options.stage,
    message: safeMessageOf(value),
    userMessageKey: options.userMessageKey,
    ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
    ...(options.fallbackAllowed === undefined ? {} : { fallbackAllowed: options.fallbackAllowed }),
    ...(options.safeContext === undefined ? {} : { safeContext: options.safeContext }),
    ...(causeCode === undefined ? {} : { causeCode }),
  });
}
