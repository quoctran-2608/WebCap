import type { CaptureEngineKind, CaptureMode } from "@shared/contracts/domain";
import type { ErrorStage, WebCapErrorCode } from "@shared/errors/error";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface SafeLogContext {
  extensionVersion?: string;
  jobId?: string;
  mode?: CaptureMode;
  engine?: CaptureEngineKind;
  stage?: ErrorStage;
  tileIndex?: number;
  tileCount?: number;
  durationBucket?: string;
  errorCode?: WebCapErrorCode;
  chromeVersionBucket?: string;
}

export interface SafeLogRecord extends SafeLogContext {
  timestamp: string;
  level: LogLevel;
  event: string;
}

export interface LogSink {
  write(record: SafeLogRecord): void;
}

export interface LoggerOptions {
  minimumLevel?: LogLevel;
  sink?: LogSink;
  now?: () => Date;
}

const consoleSink: LogSink = {
  write(record) {
    const method = record.level === "debug" ? "debug" : record.level;
    console[method](record);
  },
};

function safeToken(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined || /https?:|www\.|bearer|cookie|token=|authorization/iu.test(value)) {
    return undefined;
  }
  const sanitized = value.replace(/[^a-zA-Z0-9._<>=-]/gu, "_").slice(0, maxLength);
  return sanitized.length === 0 ? undefined : sanitized;
}

function safeCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function safeRecord(
  level: LogLevel,
  event: string,
  timestamp: string,
  context: SafeLogContext,
): SafeLogRecord {
  const eventName = safeToken(event, 120) ?? "redacted";
  const extensionVersion = safeToken(context.extensionVersion, 80);
  const jobId = safeToken(context.jobId, 12);
  const tileIndex = safeCount(context.tileIndex);
  const tileCount = safeCount(context.tileCount);
  const durationBucket = safeToken(context.durationBucket, 40);
  const chromeVersionBucket = safeToken(context.chromeVersionBucket, 40);
  return {
    timestamp,
    level,
    event: eventName,
    ...(extensionVersion === undefined ? {} : { extensionVersion }),
    ...(jobId === undefined ? {} : { jobId }),
    ...(context.mode === undefined ? {} : { mode: context.mode }),
    ...(context.engine === undefined ? {} : { engine: context.engine }),
    ...(context.stage === undefined ? {} : { stage: context.stage }),
    ...(tileIndex === undefined ? {} : { tileIndex }),
    ...(tileCount === undefined ? {} : { tileCount }),
    ...(durationBucket === undefined ? {} : { durationBucket }),
    ...(context.errorCode === undefined ? {} : { errorCode: context.errorCode }),
    ...(chromeVersionBucket === undefined ? {} : { chromeVersionBucket }),
  };
}

export function createLogger(options: LoggerOptions = {}) {
  const minimumLevel = options.minimumLevel ?? "warn";
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? (() => new Date());

  function log(level: LogLevel, event: string, context: SafeLogContext = {}): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel]) {
      return;
    }

    sink.write(safeRecord(level, event, now().toISOString(), context));
  }

  return {
    debug: (event: string, context?: SafeLogContext) => log("debug", event, context),
    info: (event: string, context?: SafeLogContext) => log("info", event, context),
    warn: (event: string, context?: SafeLogContext) => log("warn", event, context),
    error: (event: string, context?: SafeLogContext) => log("error", event, context),
  };
}
