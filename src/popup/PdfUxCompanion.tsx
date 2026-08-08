import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { copyText } from "@shared/clipboard";
import { serializeSafeDiagnostics } from "@shared/diagnostics";
import type { CaptureJob } from "@shared/contracts/domain";
import type { TabCapabilityPayload } from "@shared/contracts/messages";
import type { PdfSourceCapability } from "@shared/contracts/pdf-source";
import { t } from "@shared/i18n";
import { useUiLocale } from "@shared/use-ui-locale";

import { captureSettingsForOutput } from "./capture-settings";
import {
  getActiveCaptureJob,
  getCaptureJob,
  resumeCaptureJob,
  startScrollAreaCapture,
} from "./full-page-client";
import { shouldRefreshJobFromSummary, subscribeToJobSummaryChanges } from "./job-events-client";
import { PdfExperienceCard } from "./PdfExperienceCard";
import { inspectPdfSource } from "./pdf-source-client";
import { buildPdfUxSnapshot, isDedicatedViewerPdfJob, pdfUxCopy } from "./pdf-ux";
import { PopupSettingsClient, selectedImageFormat } from "./settings-client";
import { usePdfDocumentManifest } from "./use-pdf-document-manifest";
import { getTabCapability } from "./worker-client";

const RECONCILIATION_MS = 7_500;
const popupSettingsClient = new PopupSettingsClient();

function isBusy(job: CaptureJob | undefined): boolean {
  return (
    job !== undefined &&
    ["created", "preparing", "capturing", "processing", "exporting", "cancelling"].includes(
      job.state,
    )
  );
}

export function PdfUxCompanion(): React.JSX.Element | null {
  const { locale } = useUiLocale();
  const [host, setHost] = useState<HTMLElement>();
  const [tab, setTab] = useState<TabCapabilityPayload>();
  const [capability, setCapability] = useState<PdfSourceCapability>();
  const [job, setJob] = useState<CaptureJob>();
  const [operationBusy, setOperationBusy] = useState(false);
  const [error, setError] = useState(false);
  const [diagnosticsNotice, setDiagnosticsNotice] = useState<string>();
  const manifest = usePdfDocumentManifest(job);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".popup-shell");
    const capturePanel = shell?.querySelector<HTMLElement>(".capture-panel");
    if (
      shell === undefined ||
      shell === null ||
      capturePanel === undefined ||
      capturePanel === null
    ) {
      return;
    }
    const container = document.createElement("div");
    container.dataset.webcapPdfUx = "s35";
    shell.insertBefore(container, capturePanel);
    setHost(container);
    return () => {
      container.remove();
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const currentTab = await getTabCapability();
    setTab(currentTab);
    const [nextCapability, activeJob] = await Promise.all([
      inspectPdfSource().catch(() => undefined),
      currentTab.tabId === undefined
        ? Promise.resolve(undefined)
        : getActiveCaptureJob(currentTab.tabId).catch(() => undefined),
    ]);
    setCapability(nextCapability);
    setJob(activeJob);
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (job === undefined || tab?.tabId === undefined) return;
    const tabId = tab.tabId;
    let latestRevision = job.stateRevision;
    return subscribeToJobSummaryChanges((summary) => {
      if (
        !shouldRefreshJobFromSummary(summary, {
          tabId,
          jobId: job.id,
          stateRevision: latestRevision,
        })
      ) {
        return;
      }
      latestRevision = summary.stateRevision;
      void getCaptureJob(job.id)
        .then(setJob)
        .catch(() => undefined);
    });
  }, [job?.id, job?.stateRevision, tab?.tabId]);

  useEffect(() => {
    if (job === undefined || (!isBusy(job) && job.state !== "paused")) return;
    const timer = globalThis.setInterval(() => {
      void getCaptureJob(job.id)
        .then(setJob)
        .catch(() => undefined);
    }, RECONCILIATION_MS);
    return () => globalThis.clearInterval(timer);
  }, [job?.id, job?.state]);

  const handleCaptureViewer = useCallback(async (): Promise<void> => {
    if (tab?.tabId === undefined || tab.windowId === undefined) return;
    setOperationBusy(true);
    setError(false);
    try {
      const settingsSnapshot = await popupSettingsClient.load();
      const imageFormat = selectedImageFormat(settingsSnapshot.outputByMode, "scroll-area");
      const started = await startScrollAreaCapture({
        tabId: tab.tabId,
        windowId: tab.windowId,
        settings: captureSettingsForOutput(settingsSnapshot.capture, imageFormat),
      });
      setJob(started);
    } catch {
      setError(true);
    } finally {
      setOperationBusy(false);
    }
  }, [tab?.tabId, tab?.windowId]);

  const handleResume = useCallback(async (): Promise<void> => {
    if (job === undefined) return;
    setOperationBusy(true);
    setError(false);
    try {
      const resumed = await resumeCaptureJob(job.id);
      setJob(resumed);
      globalThis.setTimeout(() => {
        void getCaptureJob(job.id)
          .then(setJob)
          .catch(() => undefined);
      }, 250);
    } catch {
      setError(true);
    } finally {
      setOperationBusy(false);
    }
  }, [job]);

  const snapshot = useMemo(
    () => (job === undefined ? undefined : buildPdfUxSnapshot(job, manifest)),
    [job, manifest],
  );

  const diagnosticsJson = useMemo(() => {
    if (job === undefined || !isDedicatedViewerPdfJob(job)) return undefined;
    return serializeSafeDiagnostics({
      extensionVersion: chrome.runtime.getManifest().version,
      locale,
      surface: "popup",
      ...(tab?.status === undefined ? {} : { tabStatus: tab.status }),
      job: {
        id: job.id,
        mode: job.mode,
        state: job.state,
        ...(job.activeEngine === undefined ? {} : { engine: job.activeEngine }),
        completedTiles: job.completedTiles,
        totalTiles: job.totalTiles,
        ...(job.documentPageMap === undefined
          ? {}
          : {
              ...(snapshot?.completedPages === undefined
                ? {}
                : { completedDocumentPages: snapshot.completedPages }),
              totalDocumentPages: job.documentPageMap.sourcePageCount,
            }),
        ...(job.partialCapture === undefined
          ? {}
          : { partialCaptureReason: job.partialCapture.reason }),
        ...(job.error === undefined ? {} : { errorCode: job.error.code }),
      },
      pdf: {
        ...(capability?.status === undefined ? {} : { status: capability.status }),
        ...(capability?.permission === undefined ? {} : { permission: capability.permission }),
        ...(manifest?.sourceStrategy === undefined ? {} : { strategy: manifest.sourceStrategy }),
        ...(manifest?.state === undefined ? {} : { manifestState: manifest.state }),
        ...(manifest?.viewerAdapter === undefined ? {} : { viewerAdapter: manifest.viewerAdapter }),
        ...(manifest?.expectedPageCount === undefined
          ? {}
          : { expectedPages: manifest.expectedPageCount }),
        ...(manifest === undefined
          ? {}
          : {
              discoveredPages: manifest.progress.discoveredPages,
              capturedPages: manifest.progress.capturedPages,
              verifiedPages: manifest.progress.verifiedPages,
              outputPages: manifest.progress.outputPages,
              currentBatch: manifest.progress.currentBatch,
            }),
        ...(snapshot === undefined ? {} : { verifiedComplete: snapshot.verifiedComplete }),
      },
      chromeVersion: navigator.userAgent,
    });
  }, [capability, job, locale, manifest, snapshot, tab?.status]);

  const handleCopyDiagnostics = useCallback(async (): Promise<void> => {
    if (diagnosticsJson === undefined) return;
    try {
      await copyText(diagnosticsJson);
      setDiagnosticsNotice(t(locale, "common.diagnosticsCopied"));
    } catch {
      setDiagnosticsNotice(t(locale, "common.diagnosticsCopyFailed"));
    }
  }, [diagnosticsJson, locale]);

  if (host === undefined) return null;
  const relevant =
    isDedicatedViewerPdfJob(job) ||
    (capability?.canCaptureViewer === true &&
      (capability.status === "viewer-capture" || capability.status === "auth-required"));
  if (!relevant) return null;

  return createPortal(
    <>
      <PdfExperienceCard
        locale={locale}
        capability={capability}
        job={job}
        manifest={manifest}
        busy={operationBusy || isBusy(job)}
        onCaptureViewer={() => void handleCaptureViewer()}
        onResume={() => void handleResume()}
      />
      {error && (
        <div className="feedback feedback--error" role="alert">
          <p>{pdfUxCopy(locale, "operationFailed")}</p>
        </div>
      )}
      {diagnosticsJson !== undefined && (
        <details className="status-details" data-testid="pdf-verification-diagnostics">
          <summary>{pdfUxCopy(locale, "diagnosticsSummary")}</summary>
          <button
            className="secondary-action diagnostics-action"
            type="button"
            onClick={() => void handleCopyDiagnostics()}
          >
            {t(locale, "common.copyDiagnostics")}
          </button>
          {diagnosticsNotice !== undefined && (
            <p className="diagnostics-notice" role="status" aria-live="polite">
              {diagnosticsNotice}
            </p>
          )}
        </details>
      )}
    </>,
    host,
  );
}
