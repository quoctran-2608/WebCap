import type { CaptureJob } from "@shared/contracts/domain";
import type { PdfDocumentManifest } from "@shared/contracts/pdf-capture";
import type { PdfSourceCapability } from "@shared/contracts/pdf-source";
import type { UiLocale } from "@shared/i18n";

import { buildPdfUxSnapshot, isDedicatedViewerPdfJob, pdfUxCopy } from "./pdf-ux";

export interface PdfExperienceCardProps {
  locale: UiLocale;
  capability?: PdfSourceCapability;
  job?: CaptureJob;
  manifest?: PdfDocumentManifest;
  busy: boolean;
  onCaptureViewer: () => void;
  onResume: () => void;
}

function stageCopy(locale: UiLocale, stage: ReturnType<typeof buildPdfUxSnapshot>["stage"]): string {
  switch (stage) {
    case "verifying":
      return pdfUxCopy(locale, "verifying");
    case "writing":
      return pdfUxCopy(locale, "writing");
    case "paused":
      return pdfUxCopy(locale, "paused");
    case "completed":
      return pdfUxCopy(locale, "progressTitle");
    case "capturing":
      return pdfUxCopy(locale, "capturing");
  }
}

export function PdfExperienceCard({
  locale,
  capability,
  job,
  manifest,
  busy,
  onCaptureViewer,
  onResume,
}: PdfExperienceCardProps): React.JSX.Element | null {
  const dedicated = isDedicatedViewerPdfJob(job);
  const canSuggestViewerCapture =
    !dedicated &&
    capability?.canCaptureViewer === true &&
    (capability.status === "viewer-capture" || capability.status === "auth-required");

  if (!dedicated && !canSuggestViewerCapture) return null;

  if (!dedicated || job === undefined) {
    return (
      <section className="pdf-source-card" data-testid="pdf-viewer-entry">
        <div className="section-heading">
          <div>
            <p className="section-heading__eyebrow">PDF ENGINE V2</p>
            <h2>{pdfUxCopy(locale, "entryTitle")}</h2>
          </div>
        </div>
        <p className="pdf-source-card__detail">{pdfUxCopy(locale, "entryDetail")}</p>
        <button className="primary-action" type="button" disabled={busy} onClick={onCaptureViewer}>
          {pdfUxCopy(locale, "entryAction")}
        </button>
      </section>
    );
  }

  const snapshot = buildPdfUxSnapshot(job, manifest);
  const pageProgress = pdfUxCopy(locale, "pageProgress", {
    completed: snapshot.completedPages,
    total: snapshot.totalPages,
  });
  const resultCopy =
    snapshot.resultKind === "multipart"
      ? pdfUxCopy(locale, "multipart")
      : snapshot.verifiedComplete
        ? pdfUxCopy(locale, "verified", {
            completed: manifest?.progress.verifiedPages ?? snapshot.completedPages,
            total: manifest?.expectedPageCount ?? snapshot.totalPages,
          })
        : pdfUxCopy(locale, "legacyResult");

  return (
    <section
      className="pdf-source-card"
      aria-live="polite"
      data-testid="pdf-experience-card"
      data-stage={snapshot.stage}
      data-verified={snapshot.verifiedComplete ? "true" : "false"}
    >
      <div className="section-heading">
        <div>
          <p className="section-heading__eyebrow">PDF ENGINE V2</p>
          <h2>{pdfUxCopy(locale, "progressTitle")}</h2>
        </div>
      </div>

      {snapshot.stage === "completed" ? (
        <p className="pdf-source-card__detail" data-testid="pdf-strategy-result">
          {resultCopy}
        </p>
      ) : (
        <>
          <p className="pdf-source-card__detail">{stageCopy(locale, snapshot.stage)}</p>
          <div className="progress-card" data-testid="pdf-page-progress">
            <div>
              <strong>{pageProgress}</strong>
              <small>{snapshot.percent}%</small>
              <progress
                value={snapshot.completedPages}
                max={Math.max(1, snapshot.totalPages)}
                aria-label={pageProgress}
              />
            </div>
          </div>
          {snapshot.currentBatch !== undefined && snapshot.currentBatch > 0 && (
            <small>{pdfUxCopy(locale, "batch", { batch: snapshot.currentBatch })}</small>
          )}
        </>
      )}

      {snapshot.canResume && (
        <button className="primary-action" type="button" disabled={busy} onClick={onResume}>
          {pdfUxCopy(locale, "resume")}
        </button>
      )}
    </section>
  );
}
