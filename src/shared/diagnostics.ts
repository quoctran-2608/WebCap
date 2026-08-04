import type { CaptureEngineKind, CaptureMode, JobState } from "@shared/contracts/domain";
import type { UiLocale } from "@shared/i18n";
import type { WebCapErrorCode } from "@shared/errors/error";

export interface SafeDiagnosticsInput {
  extensionVersion: string;
  locale: UiLocale;
  surface: "popup" | "editor";
  workerStatus?: "checking" | "connected" | "unavailable";
  tabStatus?: "supported" | "unsupported" | "unavailable";
  job?: {
    id?: string;
    mode?: CaptureMode;
    state?: JobState;
    engine?: CaptureEngineKind;
    completedTiles?: number;
    totalTiles?: number;
    errorCode?: WebCapErrorCode;
  };
  visible?: {
    status?: string;
    format?: string;
    errorCode?: WebCapErrorCode;
  };
  pdf?: {
    status?: string;
    permission?: string;
    errorCode?: WebCapErrorCode;
  };
  chromeVersion?: string;
  generatedAt?: string;
}

export interface SafeDiagnosticsDocument {
  schemaVersion: 1;
  generatedAt: string;
  extensionVersion: string;
  locale: UiLocale;
  surface: "popup" | "editor";
  runtime: {
    chromeVersionBucket?: string;
    workerStatus?: "checking" | "connected" | "unavailable";
    tabStatus?: "supported" | "unsupported" | "unavailable";
  };
  job?: {
    id?: string;
    mode?: CaptureMode;
    state?: JobState;
    engine?: CaptureEngineKind;
    completedTiles?: number;
    totalTiles?: number;
    errorCode?: WebCapErrorCode;
  };
  visible?: {
    status?: string;
    format?: string;
    errorCode?: WebCapErrorCode;
  };
  pdf?: {
    status?: string;
    permission?: string;
    errorCode?: WebCapErrorCode;
  };
}

function compactId(value: string | undefined): string | undefined {
  return value?.slice(0, 12);
}

function chromeVersionBucket(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /(?:Chrome|Chromium)\/(\d+)/.exec(value);
  return match?.[1] === undefined ? undefined : `Chromium ${match[1]}`;
}

function finiteCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

export function createSafeDiagnostics(input: SafeDiagnosticsInput): SafeDiagnosticsDocument {
  const compactJobId = compactId(input.job?.id);
  const completedTiles = finiteCount(input.job?.completedTiles);
  const totalTiles = finiteCount(input.job?.totalTiles);
  const versionBucket = chromeVersionBucket(input.chromeVersion);

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    extensionVersion: input.extensionVersion.slice(0, 80),
    locale: input.locale,
    surface: input.surface,
    runtime: {
      ...(versionBucket === undefined ? {} : { chromeVersionBucket: versionBucket }),
      ...(input.workerStatus === undefined ? {} : { workerStatus: input.workerStatus }),
      ...(input.tabStatus === undefined ? {} : { tabStatus: input.tabStatus }),
    },
    ...(input.job === undefined
      ? {}
      : {
          job: {
            ...(compactJobId === undefined ? {} : { id: compactJobId }),
            ...(input.job.mode === undefined ? {} : { mode: input.job.mode }),
            ...(input.job.state === undefined ? {} : { state: input.job.state }),
            ...(input.job.engine === undefined ? {} : { engine: input.job.engine }),
            ...(completedTiles === undefined ? {} : { completedTiles }),
            ...(totalTiles === undefined ? {} : { totalTiles }),
            ...(input.job.errorCode === undefined ? {} : { errorCode: input.job.errorCode }),
          },
        }),
    ...(input.visible === undefined
      ? {}
      : {
          visible: {
            ...(input.visible.status === undefined
              ? {}
              : { status: input.visible.status.slice(0, 40) }),
            ...(input.visible.format === undefined
              ? {}
              : { format: input.visible.format.slice(0, 20) }),
            ...(input.visible.errorCode === undefined
              ? {}
              : { errorCode: input.visible.errorCode }),
          },
        }),
    ...(input.pdf === undefined
      ? {}
      : {
          pdf: {
            ...(input.pdf.status === undefined ? {} : { status: input.pdf.status.slice(0, 40) }),
            ...(input.pdf.permission === undefined
              ? {}
              : { permission: input.pdf.permission.slice(0, 40) }),
            ...(input.pdf.errorCode === undefined ? {} : { errorCode: input.pdf.errorCode }),
          },
        }),
  };
}

export function serializeSafeDiagnostics(input: SafeDiagnosticsInput): string {
  return JSON.stringify(createSafeDiagnostics(input), null, 2);
}
