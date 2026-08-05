import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import iconData from "../../assets/icons.json";

import { FOUNDATION_CAPABILITIES, type CaptureCapabilities } from "@shared/capabilities";
import { copyText } from "@shared/clipboard";
import { serializeSafeDiagnostics } from "@shared/diagnostics";
import type { CaptureJob, CaptureMode, ImageFormat, OutputFormat } from "@shared/contracts/domain";
import type { TabCapabilityPayload } from "@shared/contracts/messages";
import { WebCapRuntimeError, type WebCapErrorCode } from "@shared/errors/error";
import { errorPresentation, t, type MessageKey, type UiLocale } from "@shared/i18n";
import { useUiLocale } from "@shared/use-ui-locale";
import type { PdfOriginalDownload, PdfSourceCapability } from "@shared/contracts/pdf-source";
import type {
  VisibleSessionSnapshot,
  VisibleSessionStatus,
} from "@shared/contracts/visible-session";

import { createArtifactPreview } from "./artifact-preview";
import { downloadOriginalPdf, inspectPdfSource } from "./pdf-source-client";
import { requestPdfSourcePermission } from "./pdf-source-permission";
import { estimateOutputBytes, formatBytes } from "./formatting";
import {
  cancelFullPageCapture,
  getActiveCaptureJob,
  getCaptureJob,
  resetCapture,
  startElementCapture,
  startFullPageCapture,
  startRegionCapture,
  startScrollAreaCapture,
  stopFullPageCapture,
} from "./full-page-client";
import {
  cancelVisibleCapture,
  downloadArtifact,
  exportImage,
  getCapabilities,
  getTabCapability,
  getVisibleSession,
  pingWorker,
  startVisibleCapture,
} from "./worker-client";

const CAPTURE_MODE_IDS = ["visible", "full-page", "region", "element", "scroll-area"] as const;

const OUTPUT_FORMATS: ReadonlyArray<OutputFormat> = ["png", "jpeg", "webp", "pdf"];

const IMAGE_QUALITY = 0.92;
const SESSION_POLL_MS = 350;

type WorkerStatus = "checking" | "connected" | "unavailable";
type UiStatus = VisibleSessionStatus | "idle";

function workerStatusCopy(locale: UiLocale, status: WorkerStatus): string {
  return t(locale, `popup.worker.${status}` as MessageKey);
}

function tabStatusCopy(locale: UiLocale, status: TabCapabilityPayload["status"]): string {
  return t(locale, `popup.tab.${status}` as MessageKey);
}

function captureStatusCopy(locale: UiLocale, status: Exclude<UiStatus, "idle">): string {
  return t(locale, `popup.capture.${status}` as MessageKey);
}

function genericErrorCopy(locale: UiLocale, error: unknown): string {
  const presentation =
    error instanceof WebCapRuntimeError
      ? errorPresentation(locale, error.data)
      : typeof error === "object" && error !== null && "code" in error
        ? errorPresentation(locale, error as { code: WebCapErrorCode })
        : errorPresentation(
            locale,
            error instanceof Error && error.name.startsWith("E_")
              ? (error.name as WebCapErrorCode)
              : "E_UNKNOWN",
          );
  return `${presentation.message} ${presentation.action}`;
}

function pdfCapabilityCopy(
  locale: UiLocale,
  capability: PdfSourceCapability,
): { title: string; detail: string } {
  if (capability.status === "auth-required") {
    return { title: t(locale, "popup.pdf.authTitle"), detail: t(locale, "popup.pdf.authDetail") };
  }
  if (capability.status === "viewer-capture") {
    return {
      title: t(locale, "popup.pdf.viewerTitle"),
      detail: t(locale, "popup.pdf.viewerDetail"),
    };
  }
  if (capability.status === "unsupported") {
    return {
      title: t(locale, "popup.pdf.unsupportedTitle"),
      detail: t(locale, "popup.pdf.unsupportedDetail"),
    };
  }
  if (capability.permission === "file-access-required") {
    return {
      title: t(locale, "popup.pdf.filePermissionTitle"),
      detail: t(locale, "popup.pdf.filePermissionDetail"),
    };
  }
  if (capability.permission === "host-required") {
    return {
      title: t(locale, "popup.pdf.originalTitle"),
      detail: t(locale, "popup.pdf.hostPermissionDetail"),
    };
  }
  return {
    title: t(locale, "popup.pdf.originalTitle"),
    detail: t(locale, "popup.pdf.originalDetail"),
  };
}

function tiledStatusCopy(locale: UiLocale, job: CaptureJob): string {
  const specializedStates = [
    "created",
    "preparing",
    "capturing",
    "ready",
    "failed",
    "cancelled",
  ] as const;
  if (
    (job.mode === "element" || job.mode === "region" || job.mode === "scroll-area") &&
    specializedStates.includes(job.state as (typeof specializedStates)[number])
  ) {
    const key = `popup.job.${job.mode}.${job.state}` as const;
    return t(locale, key as MessageKey);
  }
  return t(locale, `popup.job.${job.state}` as MessageKey);
}

function partialCaptureCopy(locale: UiLocale, job: CaptureJob): string | undefined {
  const reason = job.partialCapture?.reason;
  return reason === undefined ? undefined : t(locale, `popup.partial.${reason}` as MessageKey);
}

function isFullPageBusy(job: CaptureJob | undefined): boolean {
  return (
    job !== undefined &&
    ["created", "preparing", "capturing", "processing", "exporting", "cancelling"].includes(
      job.state,
    )
  );
}

export function App(): React.JSX.Element {
  const { locale, setLocale } = useUiLocale();
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("checking");
  const [workerVersion, setWorkerVersion] = useState<string>();
  const [capabilities, setCapabilities] = useState<CaptureCapabilities>(FOUNDATION_CAPABILITIES);
  const [tabCapability, setTabCapability] = useState<TabCapabilityPayload>({
    status: "unavailable",
    errorCode: "E_TAB_NOT_ACTIVE",
  });
  const [selectedMode, setSelectedMode] = useState<CaptureMode>("visible");
  const [selectedFormat, setSelectedFormat] = useState<ImageFormat>("png");
  const [session, setSession] = useState<VisibleSessionSnapshot>();
  const [fullPageJob, setFullPageJob] = useState<CaptureJob>();
  const [localStatus, setLocalStatus] = useState<UiStatus>("idle");
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [uiError, setUiError] = useState<string>();
  const [pdfCapability, setPdfCapability] = useState<PdfSourceCapability>();
  const [pdfInspecting, setPdfInspecting] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfDownload, setPdfDownload] = useState<PdfOriginalDownload>();
  const [pdfError, setPdfError] = useState<string>();
  const [diagnosticsNotice, setDiagnosticsNotice] = useState<string>();
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState<string>();
  const resumedSessionRef = useRef<string | undefined>(undefined);
  const activeCaptureRequestIdRef = useRef<string | undefined>(undefined);
  const feedbackHeadingRef = useRef<HTMLHeadingElement>(null);

  const syncSession = useCallback(async (): Promise<VisibleSessionSnapshot | undefined> => {
    const current = await getVisibleSession();
    setSession(current);
    if (current !== undefined) {
      setSelectedFormat(current.format);
    }
    return current;
  }, []);

  const syncFullPageJob = useCallback(async (jobId: string): Promise<CaptureJob> => {
    const current = await getCaptureJob(jobId);
    setFullPageJob(current);
    return current;
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const [response, workerCapabilities, currentTabCapability] = await Promise.all([
          pingWorker(),
          getCapabilities(),
          getTabCapability(),
        ]);
        if (!active) {
          return;
        }

        setWorkerVersion(response.payload.workerVersion);
        setCapabilities(workerCapabilities);
        setTabCapability(currentTabCapability);
        setWorkerStatus("connected");

        try {
          const [currentSession, activeJob] = await Promise.all([
            getVisibleSession(),
            currentTabCapability.tabId === undefined
              ? Promise.resolve(undefined)
              : getActiveCaptureJob(currentTabCapability.tabId),
          ]);
          if (active) {
            setSession(currentSession);
            if (currentSession !== undefined) {
              setSelectedFormat(currentSession.format);
            }
            if (
              activeJob !== undefined &&
              (activeJob.mode === "full-page" ||
                activeJob.mode === "region" ||
                activeJob.mode === "element" ||
                activeJob.mode === "scroll-area")
            ) {
              setFullPageJob(activeJob);
              setSelectedMode(activeJob.mode);
            }
          }
        } catch (error) {
          if (active) {
            setUiError(genericErrorCopy(locale, error));
          }
        }
      } catch {
        if (active) {
          setWorkerStatus("unavailable");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [locale]);

  useEffect(() => {
    let active = true;
    setPdfDownload(undefined);
    setPdfError(undefined);
    if (
      workerStatus !== "connected" ||
      tabCapability.status === "unavailable" ||
      tabCapability.tabId === undefined
    ) {
      setPdfCapability(undefined);
      return () => {
        active = false;
      };
    }

    setPdfInspecting(true);
    void inspectPdfSource()
      .then((capability) => {
        if (active) setPdfCapability(capability);
      })
      .catch((error: unknown) => {
        if (active) setPdfError(genericErrorCopy(locale, error));
      })
      .finally(() => {
        if (active) setPdfInspecting(false);
      });

    return () => {
      active = false;
    };
  }, [locale, tabCapability.status, tabCapability.tabId, workerStatus]);

  const status: UiStatus = localStatus === "idle" ? (session?.status ?? "idle") : localStatus;
  const visibleBusy = status === "capturing" || status === "processing" || status === "downloading";
  const fullPageBusy = isFullPageBusy(fullPageJob);
  const tiledMode =
    selectedMode === "full-page" ||
    selectedMode === "region" ||
    selectedMode === "element" ||
    selectedMode === "scroll-area";
  const busy = (tiledMode ? fullPageBusy : visibleBusy) || resetBusy;
  const terminal = tiledMode
    ? fullPageJob !== undefined &&
      ["ready", "exporting", "completed", "failed", "cancelled"].includes(fullPageJob.state)
    : status === "ready" || status === "completed" || status === "error";
  const availableFormats = OUTPUT_FORMATS.filter(
    (format): format is ImageFormat => format !== "pdf" && capabilities.outputFormats[format],
  ).map((format) => ({ id: format, label: format.toUpperCase() }));
  const selectedModeEnabled = capabilities.modes[selectedMode];
  const canCapture =
    workerStatus === "connected" &&
    tabCapability.status === "supported" &&
    selectedModeEnabled &&
    !busy;

  useEffect(() => {
    if (!visibleBusy || selectedMode !== "visible") {
      return;
    }

    const timer = globalThis.setInterval(() => {
      void syncSession().catch(() => undefined);
    }, SESSION_POLL_MS);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [selectedMode, syncSession, visibleBusy]);

  useEffect(() => {
    if (!fullPageBusy || fullPageJob === undefined) {
      return;
    }

    const timer = globalThis.setInterval(() => {
      void syncFullPageJob(fullPageJob.id).catch((error: unknown) => {
        setUiError(genericErrorCopy(locale, error));
      });
    }, SESSION_POLL_MS);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [fullPageBusy, fullPageJob, locale, syncFullPageJob]);

  useEffect(() => {
    if (terminal) {
      feedbackHeadingRef.current?.focus();
    }
  }, [terminal]);

  useEffect(() => {
    let disposed = false;
    let revoke: (() => void) | undefined;
    setPreviewUrl(undefined);

    if (session?.artifact === undefined) {
      return () => undefined;
    }

    void createArtifactPreview(session.artifact.artifactId)
      .then((preview) => {
        if (disposed) {
          preview.revoke();
          return;
        }
        revoke = () => preview.revoke();
        setPreviewUrl(preview.url);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setUiError(genericErrorCopy(locale, error));
        }
      });

    return () => {
      disposed = true;
      revoke?.();
    };
  }, [locale, session?.artifact?.artifactId]);

  const handleOperationError = useCallback(
    async (error: unknown): Promise<void> => {
      const restored = await syncSession().catch(() => undefined);
      setLocalStatus("idle");
      setUiError(
        restored?.error === undefined
          ? genericErrorCopy(locale, error)
          : genericErrorCopy(locale, restored.error),
      );
    },
    [locale, syncSession],
  );

  const runExport = useCallback(
    async (sourceArtifactId: string, format: ImageFormat, quality: number): Promise<void> => {
      setLocalStatus("processing");
      setUiError(undefined);
      try {
        await exportImage({
          sourceArtifactId,
          format,
          quality,
          exportRequestId: crypto.randomUUID(),
        });
        await syncSession();
        setLocalStatus("idle");
      } catch (error) {
        await handleOperationError(error);
      }
    },
    [handleOperationError, syncSession],
  );

  useEffect(() => {
    if (session?.status !== "captured" || session.source === undefined) {
      return;
    }

    const resumeKey = `${session.sessionId}:${session.updatedAt}`;
    if (resumedSessionRef.current === resumeKey) {
      return;
    }
    resumedSessionRef.current = resumeKey;
    void runExport(session.source.captureId, session.format, session.quality);
  }, [runExport, session]);

  const handleVisibleCapture = useCallback(async (): Promise<void> => {
    const captureRequestId = crypto.randomUUID();
    activeCaptureRequestIdRef.current = captureRequestId;
    setSession(undefined);
    setLocalStatus("capturing");
    setUiError(undefined);

    try {
      const metadata = await startVisibleCapture({
        captureRequestId,
        outputFormat: selectedFormat,
        quality: IMAGE_QUALITY,
      });
      activeCaptureRequestIdRef.current = undefined;
      await runExport(metadata.captureId, selectedFormat, IMAGE_QUALITY);
    } catch (error) {
      activeCaptureRequestIdRef.current = undefined;
      await handleOperationError(error);
    }
  }, [handleOperationError, runExport, selectedFormat]);

  const handleFullPageCapture = useCallback(async (): Promise<void> => {
    if (tabCapability.tabId === undefined || tabCapability.windowId === undefined) {
      setUiError(genericErrorCopy(locale, { code: "E_TAB_NOT_ACTIVE" }));
      return;
    }
    setFullPageJob(undefined);
    setUiError(undefined);
    try {
      const job = await startFullPageCapture({
        tabId: tabCapability.tabId,
        windowId: tabCapability.windowId,
        outputFormat: selectedFormat,
      });
      setFullPageJob(job);
      await syncFullPageJob(job.id);
    } catch (error) {
      setUiError(genericErrorCopy(locale, error));
    }
  }, [locale, selectedFormat, syncFullPageJob, tabCapability.tabId, tabCapability.windowId]);

  const handleRegionCapture = useCallback(async (): Promise<void> => {
    if (tabCapability.tabId === undefined || tabCapability.windowId === undefined) {
      setUiError(genericErrorCopy(locale, { code: "E_TAB_NOT_ACTIVE" }));
      return;
    }
    setFullPageJob(undefined);
    setUiError(undefined);
    try {
      const job = await startRegionCapture({
        tabId: tabCapability.tabId,
        windowId: tabCapability.windowId,
        outputFormat: selectedFormat,
      });
      setFullPageJob(job);
      window.close();
    } catch (error) {
      setUiError(genericErrorCopy(locale, error));
    }
  }, [locale, selectedFormat, tabCapability.tabId, tabCapability.windowId]);

  const handleElementCapture = useCallback(async (): Promise<void> => {
    if (tabCapability.tabId === undefined || tabCapability.windowId === undefined) {
      setUiError(genericErrorCopy(locale, { code: "E_TAB_NOT_ACTIVE" }));
      return;
    }
    setFullPageJob(undefined);
    setUiError(undefined);
    try {
      const job = await startElementCapture({
        tabId: tabCapability.tabId,
        windowId: tabCapability.windowId,
        outputFormat: selectedFormat,
      });
      setFullPageJob(job);
    } catch (error) {
      setUiError(genericErrorCopy(locale, error));
    }
  }, [locale, selectedFormat, tabCapability.tabId, tabCapability.windowId]);

  const handleScrollAreaCapture = useCallback(async (): Promise<void> => {
    if (tabCapability.tabId === undefined || tabCapability.windowId === undefined) {
      setUiError(genericErrorCopy(locale, { code: "E_TAB_NOT_ACTIVE" }));
      return;
    }
    setFullPageJob(undefined);
    setUiError(undefined);
    try {
      const job = await startScrollAreaCapture({
        tabId: tabCapability.tabId,
        windowId: tabCapability.windowId,
        outputFormat: selectedFormat,
      });
      setFullPageJob(job);
    } catch (error) {
      setUiError(genericErrorCopy(locale, error));
    }
  }, [locale, selectedFormat, tabCapability.tabId, tabCapability.windowId]);

  const handleCapture = useCallback(async (): Promise<void> => {
    if (!canCapture) {
      return;
    }
    if (selectedMode === "full-page") {
      await handleFullPageCapture();
      return;
    }
    if (selectedMode === "region") {
      await handleRegionCapture();
      return;
    }
    if (selectedMode === "element") {
      await handleElementCapture();
      return;
    }
    if (selectedMode === "scroll-area") {
      await handleScrollAreaCapture();
      return;
    }
    await handleVisibleCapture();
  }, [
    canCapture,
    handleElementCapture,
    handleFullPageCapture,
    handleRegionCapture,
    handleScrollAreaCapture,
    handleVisibleCapture,
    selectedMode,
  ]);

  const handleCancel = useCallback(async (): Promise<void> => {
    if (
      selectedMode === "full-page" ||
      selectedMode === "region" ||
      selectedMode === "element" ||
      selectedMode === "scroll-area"
    ) {
      if (fullPageJob === undefined) {
        return;
      }
      try {
        const job = await cancelFullPageCapture(fullPageJob.id);
        setFullPageJob(job);
        await syncFullPageJob(job.id);
      } catch (error) {
        setUiError(genericErrorCopy(locale, error));
      }
      return;
    }

    const captureRequestId = activeCaptureRequestIdRef.current ?? session?.captureRequestId;
    if (captureRequestId === undefined || status !== "capturing") {
      return;
    }

    try {
      await cancelVisibleCapture(captureRequestId);
      activeCaptureRequestIdRef.current = undefined;
      await syncSession();
      setLocalStatus("idle");
    } catch (error) {
      await handleOperationError(error);
    }
  }, [
    fullPageJob,
    handleOperationError,
    selectedMode,
    session?.captureRequestId,
    status,
    locale,
    syncFullPageJob,
    syncSession,
  ]);

  const handleNewCapture = useCallback(async (): Promise<void> => {
    const active = fullPageBusy || visibleBusy;
    if (active && !globalThis.confirm(t(locale, "popup.reset.confirmActive"))) {
      return;
    }

    setResetBusy(true);
    setResetNotice(undefined);
    setUiError(undefined);
    try {
      const report =
        fullPageJob !== undefined
          ? await resetCapture({ scope: "job", jobId: fullPageJob.id })
          : await resetCapture({ scope: "visible-session" });
      setFullPageJob(undefined);
      setSession(undefined);
      setLocalStatus("idle");
      setPreviewUrl(undefined);
      activeCaptureRequestIdRef.current = undefined;
      resumedSessionRef.current = undefined;
      setResetNotice(
        report.warning === undefined
          ? t(locale, "popup.reset.success")
          : t(locale, "popup.reset.partial"),
      );
    } catch (error) {
      setUiError(genericErrorCopy(locale, error));
    } finally {
      setResetBusy(false);
    }
  }, [fullPageBusy, fullPageJob, locale, visibleBusy]);

  const handleStopPartial = useCallback(async (): Promise<void> => {
    if (fullPageJob === undefined || fullPageJob.completedTiles === 0) return;
    try {
      const job = await stopFullPageCapture(fullPageJob.id);
      setFullPageJob(job);
      await syncFullPageJob(job.id);
    } catch (error) {
      setUiError(genericErrorCopy(locale, error));
    }
  }, [fullPageJob, locale, syncFullPageJob]);

  const handleRetry = useCallback(async (): Promise<void> => {
    if (
      selectedMode === "full-page" ||
      selectedMode === "region" ||
      selectedMode === "element" ||
      selectedMode === "scroll-area"
    ) {
      if (fullPageJob !== undefined && fullPageJob.state !== "cancelled") {
        await cancelFullPageCapture(fullPageJob.id).catch(() => undefined);
      }
      if (selectedMode === "region") {
        await handleRegionCapture();
      } else if (selectedMode === "element") {
        await handleElementCapture();
      } else if (selectedMode === "scroll-area") {
        await handleScrollAreaCapture();
      } else {
        await handleFullPageCapture();
      }
      return;
    }
    if (session?.source !== undefined) {
      await runExport(session.source.captureId, selectedFormat, IMAGE_QUALITY);
      return;
    }
    await handleVisibleCapture();
  }, [
    fullPageJob,
    handleFullPageCapture,
    handleRegionCapture,
    handleScrollAreaCapture,
    handleVisibleCapture,
    runExport,
    selectedFormat,
    selectedMode,
    session?.source,
  ]);

  const handleDownload = useCallback(async (): Promise<void> => {
    if (session?.artifact === undefined) {
      return;
    }

    setLocalStatus("downloading");
    setUiError(undefined);
    try {
      await downloadArtifact(session.artifact.artifactId);
      await syncSession();
      setLocalStatus("idle");
    } catch (error) {
      await handleOperationError(error);
    }
  }, [handleOperationError, session?.artifact, syncSession]);

  const handleOpenPdfEditor = useCallback(async (): Promise<void> => {
    if (fullPageJob === undefined) return;
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`editor.html?jobId=${encodeURIComponent(fullPageJob.id)}`),
    });
    window.close();
  }, [fullPageJob]);

  const handleRefreshPdfSource = useCallback(async (): Promise<void> => {
    setPdfInspecting(true);
    setPdfError(undefined);
    try {
      setPdfCapability(await inspectPdfSource());
    } catch (error) {
      setPdfError(genericErrorCopy(locale, error));
    } finally {
      setPdfInspecting(false);
    }
  }, [locale]);

  const handleOriginalPdfDownload = useCallback(async (): Promise<void> => {
    if (pdfCapability?.tabId === undefined) return;
    setPdfDownloading(true);
    setPdfDownload(undefined);
    setPdfError(undefined);
    try {
      const granted = await requestPdfSourcePermission(pdfCapability);
      if (!granted) {
        setPdfError(
          pdfCapability.permission === "file-access-required"
            ? t(locale, "popup.pdf.fileDenied")
            : t(locale, "popup.pdf.permissionDenied"),
        );
        return;
      }

      const refreshed = await inspectPdfSource();
      setPdfCapability(refreshed);
      if (refreshed.permission !== "granted") {
        setPdfError(t(locale, "popup.pdf.permissionMissing"));
        return;
      }

      const result = await downloadOriginalPdf(pdfCapability.tabId);
      if ("artifact" in result) {
        setPdfDownload(result);
        setPdfCapability(result.capability);
      } else {
        setPdfCapability(result);
        setPdfError(pdfCapabilityCopy(locale, result).detail);
      }
    } catch (error) {
      setPdfError(genericErrorCopy(locale, error));
    } finally {
      setPdfDownloading(false);
    }
  }, [locale, pdfCapability]);

  const sourceEstimate =
    session?.source === undefined
      ? undefined
      : estimateOutputBytes(session.source.byteLength, selectedFormat);
  const fullPageProgress =
    fullPageJob === undefined || fullPageJob.totalTiles === 0
      ? 0
      : Math.round((fullPageJob.completedTiles / fullPageJob.totalTiles) * 100);

  const diagnosticsJson = useMemo(
    () =>
      serializeSafeDiagnostics({
        extensionVersion: workerVersion ?? chrome.runtime.getManifest().version,
        locale,
        surface: "popup",
        workerStatus,
        tabStatus: tabCapability.status,
        chromeVersion: navigator.userAgent,
        ...(fullPageJob === undefined
          ? {}
          : {
              job: {
                id: fullPageJob.id,
                mode: fullPageJob.mode,
                state: fullPageJob.state,
                ...(fullPageJob.activeEngine === undefined
                  ? {}
                  : { engine: fullPageJob.activeEngine }),
                completedTiles: fullPageJob.completedTiles,
                totalTiles: fullPageJob.totalTiles,
                ...(fullPageJob.error === undefined ? {} : { errorCode: fullPageJob.error.code }),
              },
            }),
        ...(session === undefined
          ? {}
          : {
              visible: {
                status: session.status,
                format: session.format,
                ...(session.error === undefined ? {} : { errorCode: session.error.code }),
              },
            }),
        ...(pdfCapability === undefined
          ? {}
          : {
              pdf: {
                status: pdfCapability.status,
                permission: pdfCapability.permission,
              },
            }),
      }),
    [
      fullPageJob,
      locale,
      pdfCapability,
      session,
      tabCapability.status,
      workerStatus,
      workerVersion,
    ],
  );

  const handleCopyDiagnostics = useCallback(async (): Promise<void> => {
    try {
      await copyText(diagnosticsJson);
      setDiagnosticsNotice(t(locale, "common.diagnosticsCopied"));
    } catch {
      setDiagnosticsNotice(t(locale, "common.diagnosticsCopyFailed"));
    }
  }, [diagnosticsJson, locale]);

  return (
    <main className="popup-shell">
      <header className="brand">
        <img
          className="brand__icon"
          src={`data:image/png;base64,${iconData["48"]}`}
          alt=""
          width="40"
          height="40"
        />
        <div>
          <p className="brand__eyebrow">{t(locale, "popup.brandEyebrow")}</p>
          <h1>WebCap</h1>
        </div>
      </header>

      <section className="status-card" aria-label={t(locale, "popup.extensionStatus")}>
        <div className="status-row">
          <span>{t(locale, "popup.workerLabel")}</span>
          <strong
            className={`status status--${workerStatus}`}
            data-testid="worker-status"
            data-status={workerStatus}
          >
            <span className="status__dot" aria-hidden="true" />
            {workerStatusCopy(locale, workerStatus)}
          </strong>
        </div>
        <div className="status-row">
          <span>{t(locale, "popup.version")}</span>
          <strong>{workerVersion ?? chrome.runtime.getManifest().version}</strong>
        </div>
        <div className="status-row">
          <span>{t(locale, "popup.currentTab")}</span>
          <strong
            className={`status status--${tabCapability.status === "supported" ? "connected" : "pending"}`}
            data-testid="tab-status"
            data-status={tabCapability.status}
          >
            {tabStatusCopy(locale, tabCapability.status)}
          </strong>
        </div>
      </section>

      {tabCapability.status === "unsupported" && (
        <p className="restricted-page-notice" role="status" data-testid="restricted-page-copy">
          {t(locale, "popup.tab.unsupportedDetail")}
        </p>
      )}

      {(pdfInspecting || (pdfCapability !== undefined && pdfCapability.status !== "not-pdf")) && (
        <section
          className="pdf-source-card"
          aria-labelledby="pdf-source-title"
          aria-busy={pdfInspecting || pdfDownloading}
          data-testid="pdf-source-card"
          data-status={pdfCapability?.status ?? "checking"}
          data-permission={pdfCapability?.permission ?? "not-required"}
        >
          <div className="section-heading">
            <div>
              <p className="section-heading__eyebrow">{t(locale, "popup.pdf.sourceEyebrow")}</p>
              <h2 id="pdf-source-title">
                {pdfInspecting
                  ? t(locale, "popup.pdf.checking")
                  : pdfCapability === undefined
                    ? t(locale, "popup.pdf.source")
                    : pdfCapabilityCopy(locale, pdfCapability).title}
              </h2>
            </div>
            <span className="planned-badge">S17</span>
          </div>

          {pdfCapability !== undefined && (
            <>
              <p className="pdf-source-card__detail">
                {pdfCapabilityCopy(locale, pdfCapability).detail}
              </p>
              <dl className="pdf-source-metadata">
                <div>
                  <dt>{t(locale, "popup.pdf.sourceLabel")}</dt>
                  <dd>{pdfCapability.sourceLabel ?? t(locale, "popup.pdf.currentTab")}</dd>
                </div>
                <div>
                  <dt>{t(locale, "popup.pdf.fileLabel")}</dt>
                  <dd>{pdfCapability.filename ?? "document.pdf"}</dd>
                </div>
              </dl>
            </>
          )}

          {pdfCapability?.status === "original-passthrough" && (
            <button
              className="primary-action"
              type="button"
              disabled={pdfInspecting || pdfDownloading || pdfCapability.tabId === undefined}
              onClick={() => void handleOriginalPdfDownload()}
            >
              {pdfDownloading
                ? t(locale, "popup.pdf.downloadChecking")
                : pdfCapability.permission === "host-required"
                  ? t(locale, "popup.pdf.allowAndDownload")
                  : pdfCapability.permission === "file-access-required"
                    ? t(locale, "popup.pdf.checkFileAndDownload")
                    : t(locale, "popup.pdf.downloadOriginal")}
            </button>
          )}

          {(pdfCapability?.status === "auth-required" ||
            pdfCapability?.status === "viewer-capture") && (
            <button
              className="secondary-action"
              type="button"
              disabled={pdfInspecting || pdfDownloading}
              onClick={() => void handleRefreshPdfSource()}
            >
              {t(locale, "popup.pdf.recheck")}
            </button>
          )}

          {pdfDownload !== undefined && (
            <div
              className="feedback feedback--success"
              data-testid="pdf-source-download-success"
              data-download-id={pdfDownload.downloadId}
              data-checksum={pdfDownload.checksumSha256}
            >
              <strong>{t(locale, "popup.pdf.downloadSuccess")}</strong>
              <small>
                {formatBytes(pdfDownload.originalByteLength)} · SHA-256{" "}
                {pdfDownload.checksumSha256.slice(0, 12)}…
              </small>
            </div>
          )}
          {pdfError !== undefined && (
            <div className="feedback feedback--error" role="alert">
              <p>{pdfError}</p>
            </div>
          )}
        </section>
      )}

      <section className="capture-panel" aria-labelledby="capture-title" aria-busy={busy}>
        <div className="section-heading">
          <div>
            <p className="section-heading__eyebrow">{t(locale, "popup.captureModeEyebrow")}</p>
            <h2 id="capture-title">{t(locale, `popup.title.${selectedMode}` as MessageKey)}</h2>
          </div>
          <span className="planned-badge">
            {selectedMode === "visible" ? "M1" : selectedMode === "scroll-area" ? "S16" : "S14"}
          </span>
        </div>

        <div className="mode-grid" aria-label={t(locale, "popup.captureModes")}>
          {CAPTURE_MODE_IDS.map((mode) => {
            const enabled = capabilities.modes[mode];
            const selected = mode === selectedMode;
            return (
              <button
                className={`mode-button ${selected ? "mode-button--selected" : ""}`}
                type="button"
                disabled={!enabled || busy}
                aria-pressed={selected}
                onClick={() => setSelectedMode(mode)}
                key={mode}
              >
                <span>{t(locale, `popup.mode.${mode}` as MessageKey)}</span>
                <small>
                  {enabled ? t(locale, "common.available") : t(locale, "common.unavailable")}
                </small>
              </button>
            );
          })}
        </div>

        {selectedMode === "visible" ? (
          <>
            <label className="field-label" htmlFor="output-format">
              {t(locale, "popup.outputFormat")}
            </label>
            <select
              id="output-format"
              aria-label={t(locale, "popup.outputFormat")}
              value={selectedFormat}
              disabled={busy}
              onChange={(event) => setSelectedFormat(event.target.value as ImageFormat)}
            >
              {availableFormats.map((format) => (
                <option value={format.id} key={format.id}>
                  {format.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <p className="field-label">{t(locale, "popup.pdfOutputHint")}</p>
        )}

        {busy ? (
          <div className="capture-actions">
            {tiledMode && (fullPageJob?.completedTiles ?? 0) > 0 && (
              <button
                className="secondary-action"
                type="button"
                onClick={() => void handleStopPartial()}
              >
                {t(locale, "popup.stopKeep", { count: fullPageJob?.completedTiles ?? 0 })}
              </button>
            )}
            <button
              className="primary-action primary-action--danger"
              type="button"
              onClick={() => void handleCancel()}
            >
              {(fullPageJob?.completedTiles ?? 0) > 0
                ? t(locale, "popup.cancelDiscard")
                : t(locale, "popup.cancelCapture")}
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={resetBusy}
              onClick={() => void handleNewCapture()}
            >
              {resetBusy ? t(locale, "popup.reset.running") : t(locale, "popup.reset.active")}
            </button>
          </div>
        ) : selectedMode === "visible" && session?.artifact !== undefined ? null : (
          <button
            className="primary-action"
            type="button"
            disabled={
              !canCapture || fullPageJob?.state === "ready" || fullPageJob?.state === "completed"
            }
            onClick={() => void handleCapture()}
          >
            {t(locale, `popup.start.${selectedMode}` as MessageKey)}
          </button>
        )}

        {tiledMode && fullPageJob !== undefined && (
          <section className="progress-card" aria-live="polite" data-testid="full-page-progress">
            {fullPageBusy && <span className="progress-card__spinner" aria-hidden="true" />}
            <div>
              <strong>{tiledStatusCopy(locale, fullPageJob)}</strong>
              <small>
                {fullPageJob.completedTiles}/{fullPageJob.totalTiles || "?"} tile ·{" "}
                {fullPageProgress}%
              </small>
              <progress
                value={fullPageJob.completedTiles}
                max={Math.max(1, fullPageJob.totalTiles)}
                aria-label={t(locale, `popup.progress.${selectedMode}` as MessageKey)}
              />
            </div>
          </section>
        )}

        {selectedMode === "visible" && visibleBusy && (
          <section className="progress-card" aria-live="polite">
            <span className="progress-card__spinner" aria-hidden="true" />
            <div>
              <strong>{captureStatusCopy(locale, status)}</strong>
              {sourceEstimate !== undefined && (
                <small>
                  {t(locale, "popup.estimate", {
                    format: selectedFormat.toUpperCase(),
                    bytes: formatBytes(sourceEstimate),
                  })}
                </small>
              )}
            </div>
          </section>
        )}

        {selectedMode === "visible" && session?.artifact !== undefined && (
          <figure
            className="preview-card"
            data-testid="preview-card"
            data-artifact-id={session.artifact.artifactId}
          >
            <div className="preview-card__media">
              {previewUrl === undefined ? (
                <div className="preview-card__placeholder">
                  {t(locale, "popup.preview.loading")}
                </div>
              ) : (
                <img
                  src={previewUrl}
                  alt={t(locale, "popup.preview.alt")}
                  data-testid="preview-image"
                />
              )}
            </div>
            <figcaption>
              <h3 ref={feedbackHeadingRef} tabIndex={-1} data-testid="preview-heading">
                {t(locale, "popup.preview.title")}
              </h3>
              <dl
                className="preview-metadata"
                data-testid="preview-metadata"
                data-width={session.artifact.width}
                data-height={session.artifact.height}
                data-format={session.artifact.format}
                data-bytes={session.artifact.byteLength}
              >
                <div>
                  <dt>{t(locale, "popup.preview.dimensions")}</dt>
                  <dd>
                    {session.artifact.width} × {session.artifact.height} px
                  </dd>
                </div>
                <div>
                  <dt>{t(locale, "popup.preview.format")}</dt>
                  <dd>{session.artifact.format.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>{t(locale, "popup.preview.size")}</dt>
                  <dd>{formatBytes(session.artifact.byteLength)}</dd>
                </div>
              </dl>
              <div className="preview-actions">
                <button
                  className="primary-action"
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDownload()}
                >
                  {status === "downloading"
                    ? t(locale, "popup.preview.downloading")
                    : t(locale, "common.download")}
                </button>
                {session.source !== undefined && selectedFormat !== session.artifact.format && (
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRetry()}
                  >
                    {t(locale, "popup.preview.reformat")}
                  </button>
                )}
                <button
                  className="secondary-action"
                  type="button"
                  disabled={resetBusy}
                  onClick={() => void handleNewCapture()}
                >
                  {resetBusy ? t(locale, "popup.reset.running") : t(locale, "common.newCapture")}
                </button>
              </div>
            </figcaption>
          </figure>
        )}

        <div className="capture-feedback" aria-live="polite">
          {tiledMode && fullPageJob?.state === "ready" && (
            <div className="feedback feedback--success">
              <h3 ref={feedbackHeadingRef} tabIndex={-1}>
                {t(locale, `popup.ready.${selectedMode}` as MessageKey)}
              </h3>
              <p>{t(locale, "popup.ready.detail", { count: fullPageJob.completedTiles })}</p>
              {partialCaptureCopy(locale, fullPageJob) !== undefined && (
                <p className="partial-capture-warning" data-testid="partial-capture-warning">
                  {partialCaptureCopy(locale, fullPageJob)}
                </p>
              )}
              <button
                className="primary-action"
                type="button"
                onClick={() => void handleOpenPdfEditor()}
              >
                {t(locale, "popup.openEditor")}
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={resetBusy}
                onClick={() => void handleNewCapture()}
              >
                {resetBusy ? t(locale, "popup.reset.running") : t(locale, "common.newCapture")}
              </button>
            </div>
          )}
          {tiledMode && fullPageJob?.state === "completed" && (
            <div className="feedback feedback--success">
              <h3 ref={feedbackHeadingRef} tabIndex={-1}>
                {t(locale, "popup.pdfReady")}
              </h3>
              <p>{t(locale, "popup.pdfReadyDetail")}</p>
              <button
                className="primary-action"
                type="button"
                onClick={() => void handleOpenPdfEditor()}
              >
                {t(locale, "popup.openDownloadPdf")}
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={resetBusy}
                onClick={() => void handleNewCapture()}
              >
                {resetBusy ? t(locale, "popup.reset.running") : t(locale, "common.newCapture")}
              </button>
            </div>
          )}
          {tiledMode && fullPageJob?.state === "cancelled" && (
            <div className="feedback feedback--neutral">
              <p>{tiledStatusCopy(locale, fullPageJob)}</p>
              <button className="text-action" type="button" onClick={() => void handleRetry()}>
                {t(locale, "common.retry")}
              </button>
              <button
                className="text-action"
                type="button"
                disabled={resetBusy}
                onClick={() => void handleNewCapture()}
              >
                {t(locale, "common.newCapture")}
              </button>
            </div>
          )}
          {tiledMode && fullPageJob?.state === "failed" && (
            <div className="feedback feedback--error" role="alert">
              <h3 ref={feedbackHeadingRef} tabIndex={-1}>
                {t(locale, `popup.failed.${selectedMode}` as MessageKey)}
              </h3>
              <p>{genericErrorCopy(locale, fullPageJob.error ?? { code: "E_UNKNOWN" })}</p>
              {fullPageJob.activeEngine === "scroll" && (
                <p>
                  {selectedMode === "scroll-area"
                    ? t(locale, "popup.scrollAreaRestored")
                    : t(locale, "popup.scrollRestored")}
                </p>
              )}
              <button
                className="text-action"
                type="button"
                onClick={() =>
                  fullPageJob.totalTiles > 0 &&
                  fullPageJob.completedTiles === fullPageJob.totalTiles
                    ? void handleOpenPdfEditor()
                    : void handleRetry()
                }
              >
                {fullPageJob.totalTiles > 0 && fullPageJob.completedTiles === fullPageJob.totalTiles
                  ? t(locale, "popup.retryExport")
                  : selectedMode === "full-page"
                    ? t(locale, "popup.retryFullPage")
                    : t(locale, `popup.reselect.${selectedMode}` as MessageKey)}
              </button>
              <button
                className="text-action"
                type="button"
                disabled={resetBusy}
                onClick={() => void handleNewCapture()}
              >
                {t(locale, "common.newCapture")}
              </button>
            </div>
          )}
          {selectedMode === "visible" &&
            status === "completed" &&
            session?.downloadId !== undefined && (
              <div
                className="feedback feedback--success"
                data-testid="download-success"
                data-download-id={session.downloadId}
              >
                <p>{captureStatusCopy(locale, "completed")}</p>
                <button
                  className="text-action"
                  type="button"
                  disabled={resetBusy}
                  onClick={() => void handleNewCapture()}
                >
                  {t(locale, "common.newCapture")}
                </button>
              </div>
            )}
          {selectedMode === "visible" && status === "cancelled" && (
            <div className="feedback feedback--neutral">
              <p>{captureStatusCopy(locale, "cancelled")}</p>
              <button
                className="text-action"
                type="button"
                disabled={!canCapture}
                onClick={() => void handleVisibleCapture()}
              >
                {t(locale, "common.retry")}
              </button>
              <button
                className="text-action"
                type="button"
                disabled={resetBusy}
                onClick={() => void handleNewCapture()}
              >
                {t(locale, "common.newCapture")}
              </button>
            </div>
          )}
          {selectedMode === "visible" && (status === "error" || uiError !== undefined) && (
            <div className="feedback feedback--error" role="alert">
              <h3
                ref={session?.artifact === undefined ? feedbackHeadingRef : undefined}
                tabIndex={-1}
              >
                {t(locale, "popup.failed")}
              </h3>
              <p>
                {session?.error === undefined
                  ? (uiError ?? captureStatusCopy(locale, "error"))
                  : genericErrorCopy(locale, session.error)}
              </p>
              {(session?.error?.retryable ?? true) && (
                <button
                  className="text-action"
                  type="button"
                  disabled={busy || workerStatus !== "connected"}
                  onClick={() => void handleRetry()}
                >
                  {t(locale, "common.retry")}
                </button>
              )}
            </div>
          )}
          {selectedMode === "full-page" &&
            uiError !== undefined &&
            fullPageJob?.state !== "failed" && (
              <div className="feedback feedback--error" role="alert">
                <p>{uiError}</p>
              </div>
            )}
        </div>
        {resetNotice !== undefined && (
          <p className="feedback feedback--success" role="status" data-testid="reset-success">
            {resetNotice}
          </p>
        )}
      </section>

      <footer className="trust-footer">
        <span>{t(locale, "popup.footer")}</span>
        <label className="locale-control">
          <span>{t(locale, "common.language")}</span>
          <select
            value={locale}
            aria-label={t(locale, "common.language")}
            data-testid="locale-select"
            onChange={(event) => void setLocale(event.target.value as UiLocale)}
          >
            <option value="vi">{t(locale, "common.vietnamese")}</option>
            <option value="en">{t(locale, "common.english")}</option>
          </select>
        </label>
        <details className="trust-details">
          <summary>{t(locale, "common.privacy")}</summary>
          <strong>{t(locale, "common.permissions")}</strong>
          <ul>
            <li>{t(locale, "popup.trust.activeTab")}</li>
            <li>{t(locale, "popup.trust.debugger")}</li>
            <li>{t(locale, "popup.trust.scripting")}</li>
            <li>{t(locale, "popup.trust.local")}</li>
            <li>{t(locale, "popup.trust.optional")}</li>
          </ul>
          <p>
            <strong>{t(locale, "common.localOnly")}</strong> · {t(locale, "common.noAnalytics")}
          </p>
        </details>
        <button
          className="secondary-action diagnostics-action"
          type="button"
          data-testid="copy-diagnostics"
          onClick={() => void handleCopyDiagnostics()}
        >
          {t(locale, "common.copyDiagnostics")}
        </button>
        {diagnosticsNotice !== undefined && (
          <p className="diagnostics-notice" role="status" aria-live="polite">
            {diagnosticsNotice}
          </p>
        )}
      </footer>
    </main>
  );
}
