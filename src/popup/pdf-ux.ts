import type { CaptureJob } from "@shared/contracts/domain";
import { documentPageProgress } from "@shared/contracts/job";
import type {
  PdfCaptureStrategy,
  PdfDocumentManifest,
  PdfManifestState,
} from "@shared/contracts/pdf-capture";
import type { UiLocale } from "@shared/i18n";

export type PdfUxStage = "capturing" | "verifying" | "writing" | "paused" | "completed";
export type PdfUxResultKind = "viewer" | "multipart" | "legacy";

export interface PdfUxSnapshot {
  dedicatedViewer: boolean;
  stage: PdfUxStage;
  completedPages: number;
  totalPages: number;
  percent: number;
  verifiedComplete: boolean;
  canResume: boolean;
  strategy?: PdfCaptureStrategy;
  manifestState?: PdfManifestState;
  currentPage?: number;
  currentBatch?: number;
  resultKind: PdfUxResultKind;
}

function boundedCount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function expectedSourcePages(job: CaptureJob, manifest: PdfDocumentManifest | undefined): number {
  return (
    manifest?.expectedPageCount ??
    job.documentPageMap?.sourcePageCount ??
    job.exportProgress?.totalPages ??
    job.output?.pageCount ??
    0
  );
}

function manifestOutputTotal(manifest: PdfDocumentManifest): number {
  return manifest.outputPlan?.sourcePageIndexes.length ?? manifest.expectedPageCount ?? 0;
}

export function isDedicatedViewerPdfJob(job: CaptureJob | undefined): boolean {
  return (
    job?.mode === "scroll-area" &&
    job.documentPageMap?.complete === true &&
    job.documentPageMap.pages.length === job.documentPageMap.sourcePageCount &&
    job.partialCapture === undefined
  );
}

export function buildPdfUxSnapshot(
  job: CaptureJob,
  manifest?: PdfDocumentManifest,
): PdfUxSnapshot {
  const dedicatedViewer = isDedicatedViewerPdfJob(job);
  const sourceTotal = expectedSourcePages(job, manifest);
  const pageProgress = documentPageProgress(job);

  let stage: PdfUxStage = "capturing";
  let completedPages = pageProgress?.completed ?? 0;
  let totalPages = pageProgress?.total ?? sourceTotal;

  if (job.state === "paused") {
    stage = "paused";
  } else if (manifest?.state === "completed" || job.state === "completed") {
    stage = "completed";
  } else if (manifest?.state === "verifying") {
    stage = "verifying";
  } else if (
    manifest?.state === "writing" ||
    job.state === "exporting" ||
    job.activeOutputFormat === "pdf"
  ) {
    stage = "writing";
  }

  if (manifest !== undefined) {
    if (
      stage === "writing" ||
      stage === "completed" ||
      (stage === "paused" && job.activeOutputFormat === "pdf")
    ) {
      completedPages = boundedCount(manifest.progress.outputPages);
      totalPages = manifestOutputTotal(manifest);
    } else if (stage === "verifying") {
      completedPages = boundedCount(manifest.progress.verifiedPages);
      totalPages = boundedCount(manifest.expectedPageCount);
    } else {
      completedPages = Math.max(
        boundedCount(manifest.progress.capturedPages),
        boundedCount(manifest.progress.verifiedPages),
      );
      totalPages = boundedCount(manifest.expectedPageCount);
    }
  } else if (
    job.exportProgress !== undefined &&
    (job.state === "exporting" || job.activeOutputFormat === "pdf")
  ) {
    completedPages = boundedCount(job.exportProgress.completedPages);
    totalPages = boundedCount(job.exportProgress.totalPages);
  }

  const expected = boundedCount(manifest?.expectedPageCount);
  const outputTotal = manifest === undefined ? 0 : manifestOutputTotal(manifest);
  const verifiedComplete =
    manifest?.state === "completed" &&
    manifest.outputState === "completed" &&
    expected > 0 &&
    manifest.progress.discoveredPages === expected &&
    manifest.progress.capturedPages === expected &&
    manifest.progress.verifiedPages === expected &&
    outputTotal > 0 &&
    manifest.progress.outputPages === outputTotal;
  const safeTotal = Math.max(0, totalPages);
  const safeCompleted = Math.min(Math.max(0, completedPages), safeTotal || completedPages);

  return {
    dedicatedViewer,
    stage,
    completedPages: safeCompleted,
    totalPages: safeTotal,
    percent: safeTotal === 0 ? 0 : Math.round((safeCompleted / safeTotal) * 100),
    verifiedComplete,
    canResume:
      job.state === "paused" &&
      job.error?.retryable === true &&
      (job.mode === "scroll-area" || job.activeOutputFormat === "pdf"),
    ...(manifest?.sourceStrategy === undefined ? {} : { strategy: manifest.sourceStrategy }),
    ...(manifest?.state === undefined ? {} : { manifestState: manifest.state }),
    ...(manifest?.progress.currentPage === undefined
      ? {}
      : { currentPage: manifest.progress.currentPage + 1 }),
    ...(manifest === undefined ? {} : { currentBatch: manifest.progress.currentBatch }),
    resultKind:
      job.output?.pdfPart !== undefined ? "multipart" : verifiedComplete ? "viewer" : "legacy",
  };
}

export type PdfUxCopyKey =
  | "eyebrow"
  | "entryTitle"
  | "entryDetail"
  | "entryAction"
  | "progressTitle"
  | "resultTitle"
  | "capturing"
  | "verifying"
  | "writing"
  | "paused"
  | "resume"
  | "verified"
  | "multipart"
  | "legacyResult"
  | "pageProgress"
  | "batch"
  | "diagnosticsSummary"
  | "operationFailed";

const COPY: Record<UiLocale, Record<PdfUxCopyKey, string>> = {
  vi: {
    eyebrow: "PDF",
    entryTitle: "Chụp PDF đang hiển thị",
    entryDetail:
      "WebCap có thể nhận diện từng trang trong viewer, chụp theo ranh giới trang và chỉ báo 100% sau khi xác minh đầu ra.",
    entryAction: "Chụp PDF đang hiển thị",
    progressTitle: "Đang xử lý PDF",
    resultTitle: "Kết quả PDF",
    capturing: "Đang nhận diện và chụp trang",
    verifying: "Đang xác minh đủ trang nguồn",
    writing: "Đang ghi PDF theo từng trang",
    paused: "Đã tạm dừng an toàn tại ranh giới trang",
    resume: "Tiếp tục xử lý PDF",
    verified: "Bản hiển thị — {completed}/{total} trang đã xác minh",
    multipart: "PDF nhiều phần — giới hạn lưu trữ cục bộ; không trang nào bị cắt đôi",
    legacyResult: "PDF đã tạo từ dữ liệu chụp cục bộ",
    pageProgress: "Trang {completed} / {total}",
    batch: "Đợt {batch}",
    diagnosticsSummary: "Xác minh PDF",
    operationFailed: "Không thể tiếp tục thao tác PDF. Hãy thử lại.",
  },
  en: {
    eyebrow: "PDF",
    entryTitle: "Capture the displayed PDF",
    entryDetail:
      "WebCap can identify viewer pages, capture on page boundaries, and only report 100% after output verification.",
    entryAction: "Capture displayed PDF",
    progressTitle: "Processing PDF",
    resultTitle: "PDF result",
    capturing: "Discovering and capturing pages",
    verifying: "Verifying source-page completion",
    writing: "Writing the PDF page by page",
    paused: "Safely paused at a page boundary",
    resume: "Resume PDF processing",
    verified: "Rendered view — {completed}/{total} pages verified",
    multipart: "Multipart PDF — local storage limit; no logical page was split",
    legacyResult: "PDF created from local capture data",
    pageProgress: "Page {completed} / {total}",
    batch: "Batch {batch}",
    diagnosticsSummary: "PDF verification",
    operationFailed: "Unable to continue the PDF operation. Please try again.",
  },
};

export function pdfUxCopy(
  locale: UiLocale,
  key: PdfUxCopyKey,
  values: Record<string, string | number> = {},
): string {
  let result = COPY[locale][key];
  for (const [name, value] of Object.entries(values)) {
    result = result.replaceAll(`{${name}}`, String(value));
  }
  return result;
}
