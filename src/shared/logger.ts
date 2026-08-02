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

function compactJobId(jobId: string | undefined): string | undefined {
  return jobId === undefined ? undefined : jobId.slice(0, 12);
}

function safeRecord(
  level: LogLevel,
  event: string,
  timestamp: string,
  context: SafeLogContext,
): SafeLogRecord {
  const jobId = compactJobId(context.jobId);
  return {
    timestamp,
    level,
    event: event.slice(0, 120),
    ...(context.extensionVersion === undefined
      ? {}
      : { extensionVersion: context.extensionVersion.slice(0, 80) }),
    ...(jobId === undefined ? {} : { jobId }),
    ...(context.mode === undefined ? {} : { mode: context.mode }),
    ...(context.engine === undefined ? {} : { engine: context.engine }),
    ...(context.stage === undefined ? {} : { stage: context.stage }),
    ...(context.tileIndex === undefined ? {} : { tileIndex: context.tileIndex }),
    ...(context.tileCount === undefined ? {} : { tileCount: context.tileCount }),
    ...(context.durationBucket === undefined
      ? {}
      : { durationBucket: context.durationBucket.slice(0, 40) }),
    ...(context.errorCode === undefined ? {} : { errorCode: context.errorCode }),
    ...(context.chromeVersionBucket === undefined
      ? {}
      : { chromeVersionBucket: context.chromeVersionBucket.slice(0, 40) }),
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
