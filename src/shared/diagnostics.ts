import type {
  CaptureEngineKind,
  CaptureMode,
  JobState,
  PartialCaptureReason,
} from "@shared/contracts/domain";
import type { PdfCaptureStrategy, PdfManifestState } from "@shared/contracts/pdf-capture";
import type { UiLocale } from "@shared/i18n";
import type { WebCapErrorCode } from "@shared/errors/error";

export type PdfViewerAdapterBucket =
  | "s27-dom"
  | "s27-projected"
  | "pdfjs"
  | "semantic"
  | "shadow-dom"
  | "virtualized"
  | "canvas-visual"
  | "other";

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
    completedDocumentPages?: number;
    totalDocumentPages?: number;
    partialCaptureReason?: PartialCaptureReason;
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
    strategy?: PdfCaptureStrategy;
    manifestState?: PdfManifestState;
    viewerAdapter?: string;
    expectedPages?: number;
    discoveredPages?: number;
    capturedPages?: number;
    verifiedPages?: number;
    outputPages?: number;
    currentBatch?: number;
    verifiedComplete?: boolean;
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
    completedDocumentPages?: number;
    totalDocumentPages?: number;
    partialCaptureReason?: PartialCaptureReason;
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
    strategy?: PdfCaptureStrategy;
    manifestState?: PdfManifestState;
    viewerAdapterBucket?: PdfViewerAdapterBucket;
    expectedPages?: number;
    discoveredPages?: number;
    capturedPages?: number;
    verifiedPages?: number;
    outputPages?: number;
    currentBatch?: number;
    verification?: "verified" | "pending";
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

function viewerAdapterBucket(value: string | undefined): PdfViewerAdapterBucket | undefined {
  switch (value) {
    case "s27-dom":
    case "s27-projected":
    case "pdfjs":
    case "semantic":
    case "shadow-dom":
    case "virtualized":
    case "canvas-visual":
      return value;
    case undefined:
      return undefined;
    default:
      return "other";
  }
}

export function createSafeDiagnostics(input: SafeDiagnosticsInput): SafeDiagnosticsDocument {
  const compactJobId = compactId(input.job?.id);
  const completedTiles = finiteCount(input.job?.completedTiles);
  const totalTiles = finiteCount(input.job?.totalTiles);
  const completedDocumentPages = finiteCount(input.job?.completedDocumentPages);
  const totalDocumentPages = finiteCount(input.job?.totalDocumentPages);
  const versionBucket = chromeVersionBucket(input.chromeVersion);
  const expectedPages = finiteCount(input.pdf?.expectedPages);
  const discoveredPages = finiteCount(input.pdf?.discoveredPages);
  const capturedPages = finiteCount(input.pdf?.capturedPages);
  const verifiedPages = finiteCount(input.pdf?.verifiedPages);
  const outputPages = finiteCount(input.pdf?.outputPages);
  const currentBatch = finiteCount(input.pdf?.currentBatch);
  const adapterBucket = viewerAdapterBucket(input.pdf?.viewerAdapter);

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
            ...(completedDocumentPages === undefined ? {} : { completedDocumentPages }),
            ...(totalDocumentPages === undefined ? {} : { totalDocumentPages }),
            ...(input.job.partialCaptureReason === undefined
              ? {}
              : { partialCaptureReason: input.job.partialCaptureReason }),
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
            ...(input.pdf.strategy === undefined ? {} : { strategy: input.pdf.strategy }),
            ...(input.pdf.manifestState === undefined
              ? {}
              : { manifestState: input.pdf.manifestState }),
            ...(adapterBucket === undefined ? {} : { viewerAdapterBucket: adapterBucket }),
            ...(expectedPages === undefined ? {} : { expectedPages }),
            ...(discoveredPages === undefined ? {} : { discoveredPages }),
            ...(capturedPages === undefined ? {} : { capturedPages }),
            ...(verifiedPages === undefined ? {} : { verifiedPages }),
            ...(outputPages === undefined ? {} : { outputPages }),
            ...(currentBatch === undefined ? {} : { currentBatch }),
            ...(input.pdf.verifiedComplete === undefined
              ? {}
              : { verification: input.pdf.verifiedComplete ? "verified" : "pending" }),
          },
        }),
  };
}

export function serializeSafeDiagnostics(input: SafeDiagnosticsInput): string {
  return JSON.stringify(createSafeDiagnostics(input), null, 2);
}
