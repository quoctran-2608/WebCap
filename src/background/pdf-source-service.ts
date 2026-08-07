import { PDFDocument } from "pdf-lib";

import type { ActiveTabSnapshot, TabsCaptureAdapter } from "./chrome-tabs-adapter";
import type { PdfSourceCdpRecoveryPort, RecoveredPdfSource } from "./pdf-source-cdp-recovery";
import {
  contentDispositionFilename,
  contentTypeIsPdf,
  resolvePdfSourceCandidates,
  type PdfSourceCandidate,
} from "./pdf-source-detection";
import type { PdfSourceDiscoveryPort } from "./pdf-source-discovery";
import { spoolPdfReadableStream, type StreamedPdfSource } from "./pdf-source-stream";
import { PDF_SOURCE_DOWNLOAD_TIMEOUT_MS, PDF_SOURCE_PROBE_TIMEOUT_MS } from "@shared/constants";
import type { DownloadService } from "./download-service";
import type {
  PdfOriginalDownload,
  PdfSourceCapability,
  PdfSourceSignals,
} from "@shared/contracts/pdf-source";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { PdfSourceSpoolPort, PdfSourceSpoolWriter } from "@storage/pdf-source-spool";

const DEFAULT_ARTIFACT_TTL_MS = 30 * 60 * 1000;
const PDF_GEOMETRY_INSPECT_MAX_BYTES = 16 * 1024 * 1024;

export interface PdfSourcePermissionPort {
  containsOrigin(origin: string): Promise<boolean>;
  isFileAccessAllowed(): Promise<boolean>;
}

export interface PdfSourceFetchPort {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export interface PdfSourceServiceOptions {
  tabs: Pick<TabsCaptureAdapter, "queryActiveTab">;
  permissions: PdfSourcePermissionPort;
  fetcher: PdfSourceFetchPort;
  artifacts: ArtifactRepositoryPort;
  downloads: Pick<DownloadService, "download">;
  spool: PdfSourceSpoolPort;
  discovery?: PdfSourceDiscoveryPort;
  cdpRecovery?: PdfSourceCdpRecoveryPort;
  now?: () => Date;
  createId?: () => string;
  artifactTtlMs?: number;
  probeTimeoutMs?: number;
  downloadTimeoutMs?: number;
}

interface AcquiredPdfSource extends StreamedPdfSource {
  filename: string;
  contentTypeSignal: boolean;
  cleanup(): Promise<void>;
}

function emptySignals(candidate?: PdfSourceCandidate): PdfSourceSignals {
  return {
    urlExtension: candidate?.urlExtensionSignal ?? false,
    contentType: false,
    chromePdfViewer: candidate?.chromePdfViewerSignal ?? false,
    signature: false,
  };
}

function capability(
  candidate: PdfSourceCandidate | undefined,
  options: Pick<
    PdfSourceCapability,
    "status" | "permission" | "reason" | "canDownloadOriginal" | "canCaptureViewer"
  > & { signals?: PdfSourceSignals },
): PdfSourceCapability {
  return {
    status: options.status,
    permission: options.permission,
    reason: options.reason,
    canDownloadOriginal: options.canDownloadOriginal,
    canCaptureViewer: options.canCaptureViewer,
    signals: options.signals ?? emptySignals(candidate),
    ...(candidate === undefined
      ? {}
      : {
          tabId: candidate.tabId,
          scheme: candidate.scheme,
          sourceLabel: candidate.sourceLabel,
          filename: candidate.filename,
          permissionOrigin: candidate.permissionOrigin,
        }),
  };
}

function unsupportedCapability(tab?: ActiveTabSnapshot): PdfSourceCapability {
  const scheme = (() => {
    try {
      return tab?.url === undefined ? undefined : new URL(tab.url).protocol.replace(/:$/u, "");
    } catch {
      return undefined;
    }
  })();
  return {
    status: "unsupported",
    permission: "not-required",
    reason: "unsupported-scheme",
    canDownloadOriginal: false,
    canCaptureViewer: false,
    signals: emptySignals(),
    ...(tab?.id === undefined ? {} : { tabId: tab.id }),
    ...(scheme === undefined ? {} : { scheme }),
  };
}

function sourceChangedError(): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_TARGET_STALE",
      stage: "prepare",
      message: "The active PDF tab changed before the original download started.",
      userMessageKey: "errors.pdfSourceChanged",
      retryable: true,
      fallbackAllowed: true,
      causeCode: "PdfSourceTabChanged",
    }),
  );
}

async function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function permissionState(
  candidate: PdfSourceCandidate,
  permissions: PdfSourcePermissionPort,
): Promise<PdfSourceCapability["permission"]> {
  if (candidate.scheme === "file") {
    return (await permissions.isFileAccessAllowed()) ? "granted" : "file-access-required";
  }
  return (await permissions.containsOrigin(candidate.permissionOrigin))
    ? "granted"
    : "host-required";
}

async function pdfGeometry(blob: Blob): Promise<{
  width: number;
  height: number;
  pageCount?: number;
}> {
  if (blob.size > PDF_GEOMETRY_INSPECT_MAX_BYTES) return { width: 1, height: 1 };
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const first = document.getPages()[0];
    const size = first?.getSize();
    return {
      width: Math.max(1, Math.round(size?.width ?? 1)),
      height: Math.max(1, Math.round(size?.height ?? 1)),
      pageCount: Math.max(1, document.getPageCount()),
    };
  } catch {
    // Encrypted or unusual originals are still valid passthrough artifacts.
    return { width: 1, height: 1 };
  }
}

function responseContentLength(response: Response): number | undefined {
  const parsed = Number(response.headers.get("content-length"));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export class PdfSourceService {
  private readonly tabs: Pick<TabsCaptureAdapter, "queryActiveTab">;
  private readonly permissions: PdfSourcePermissionPort;
  private readonly fetcher: PdfSourceFetchPort;
  private readonly artifacts: ArtifactRepositoryPort;
  private readonly downloads: Pick<DownloadService, "download">;
  private readonly spool: PdfSourceSpoolPort;
  private readonly discovery: PdfSourceDiscoveryPort | undefined;
  private readonly cdpRecovery: PdfSourceCdpRecoveryPort | undefined;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly artifactTtlMs: number;
  private readonly probeTimeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly inFlight = new Map<string, Promise<PdfOriginalDownload | PdfSourceCapability>>();
  private readonly completed = new Map<string, PdfOriginalDownload | PdfSourceCapability>();

  constructor(options: PdfSourceServiceOptions) {
    this.tabs = options.tabs;
    this.permissions = options.permissions;
    this.fetcher = options.fetcher;
    this.artifacts = options.artifacts;
    this.downloads = options.downloads;
    this.spool = options.spool;
    this.discovery = options.discovery;
    this.cdpRecovery = options.cdpRecovery;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.artifactTtlMs = options.artifactTtlMs ?? DEFAULT_ARTIFACT_TTL_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? PDF_SOURCE_PROBE_TIMEOUT_MS;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? PDF_SOURCE_DOWNLOAD_TIMEOUT_MS;
  }

  async inspect(): Promise<PdfSourceCapability> {
    const tab = await this.tabs.queryActiveTab();
    if (tab === undefined || !tab.active) return unsupportedCapability(tab);
    const candidates = await this.sourceCandidates(tab);
    if (candidates.length === 0) return unsupportedCapability(tab);

    let fallback: PdfSourceCapability | undefined;
    for (const candidate of candidates) {
      const permission = await permissionState(candidate, this.permissions);
      if (permission !== "granted") {
        const denied = capability(candidate, {
          status:
            candidate.urlExtensionSignal || candidate.chromePdfViewerSignal
              ? "original-passthrough"
              : "not-pdf",
          permission,
          reason:
            permission === "file-access-required" ? "file-access-disabled" : "permission-missing",
          canDownloadOriginal: candidate.urlExtensionSignal || candidate.chromePdfViewerSignal,
          canCaptureViewer: candidate.canCaptureViewer,
        });
        fallback ??= denied;
        continue;
      }

      if (candidate.scheme === "file") {
        if (candidate.urlExtensionSignal) {
          return capability(candidate, {
            status: "original-passthrough",
            permission,
            reason: "url-extension",
            canDownloadOriginal: true,
            canCaptureViewer: true,
          });
        }
        continue;
      }

      try {
        const response = await withTimeout(this.probeTimeoutMs, (signal) =>
          this.fetcher.fetch(candidate.url.href, {
            method: "HEAD",
            credentials: "include",
            cache: "no-store",
            redirect: "follow",
            signal,
          }),
        );
        if (response.status === 401 || response.status === 403) {
          fallback ??= capability(candidate, {
            status: "auth-required",
            permission,
            reason: "auth-required",
            canDownloadOriginal: false,
            canCaptureViewer: true,
          });
          continue;
        }
        const contentTypeSignal = contentTypeIsPdf(response.headers.get("content-type"));
        const signals = { ...emptySignals(candidate), contentType: contentTypeSignal };
        if (
          contentTypeSignal ||
          candidate.urlExtensionSignal ||
          candidate.chromePdfViewerSignal ||
          candidate.scheme === "blob"
        ) {
          return capability(candidate, {
            status: "original-passthrough",
            permission,
            reason: contentTypeSignal
              ? "content-type"
              : candidate.chromePdfViewerSignal
                ? "chrome-pdf-viewer"
                : "url-extension",
            canDownloadOriginal: true,
            canCaptureViewer: true,
            signals,
          });
        }
      } catch {
        if (candidate.urlExtensionSignal || candidate.chromePdfViewerSignal || candidate.scheme === "blob") {
          return capability(candidate, {
            status: "original-passthrough",
            permission,
            reason: candidate.chromePdfViewerSignal ? "chrome-pdf-viewer" : "url-extension",
            canDownloadOriginal: true,
            canCaptureViewer: true,
          });
        }
      }
    }

    return (
      fallback ??
      capability(candidates[0], {
        status: "not-pdf",
        permission: "granted",
        reason: "not-pdf-url",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      })
    );
  }

  downloadOriginal(
    requestId: string,
    expectedTabId: number,
  ): Promise<PdfOriginalDownload | PdfSourceCapability> {
    const done = this.completed.get(requestId);
    if (done !== undefined) return Promise.resolve(done);
    const active = this.inFlight.get(requestId);
    if (active !== undefined) return active;
    const operation = this.processDownload(expectedTabId).then((result) => {
      this.completed.set(requestId, result);
      while (this.completed.size > 16) {
        const oldest = this.completed.keys().next().value;
        if (oldest === undefined) break;
        this.completed.delete(oldest);
      }
      return result;
    });
    this.inFlight.set(requestId, operation);
    void operation.then(
      () => this.inFlight.delete(requestId),
      () => this.inFlight.delete(requestId),
    );
    return operation;
  }

  private async sourceCandidates(tab: ActiveTabSnapshot): Promise<PdfSourceCandidate[]> {
    const discoveredUrls =
      this.discovery === undefined ? [] : await this.discovery.discover(tab.id).catch(() => []);
    return resolvePdfSourceCandidates({
      tabId: tab.id,
      ...(tab.url === undefined ? {} : { tabUrl: tab.url }),
      discoveredUrls,
    });
  }

  private async processDownload(
    expectedTabId: number,
  ): Promise<PdfOriginalDownload | PdfSourceCapability> {
    const tab = await this.tabs.queryActiveTab();
    if (tab === undefined || !tab.active || tab.id !== expectedTabId) throw sourceChangedError();
    const candidates = await this.sourceCandidates(tab);
    if (candidates.length === 0) return unsupportedCapability(tab);

    let fallback: PdfSourceCapability | undefined;
    for (const candidate of candidates) {
      const permission = await permissionState(candidate, this.permissions);
      if (permission !== "granted") {
        fallback ??= capability(candidate, {
          status: "original-passthrough",
          permission,
          reason:
            permission === "file-access-required" ? "file-access-disabled" : "permission-missing",
          canDownloadOriginal: true,
          canCaptureViewer: true,
        });
        continue;
      }

      const artifactId = this.createId();
      const direct = await this.acquireDirect(candidate, artifactId).catch(() => undefined);
      if (direct !== undefined) {
        if ("blob" in direct) {
          return this.persistAndDownload(tab, candidate, permission, artifactId, direct);
        }
        fallback ??= direct;
      }

      const recovered = await this.acquireCdp(candidate, artifactId).catch(() => undefined);
      if (recovered !== undefined) {
        if (!recovered.signature) {
          await recovered.cleanup().catch(() => undefined);
          fallback ??= capability(candidate, {
            status: "viewer-capture",
            permission,
            reason: "response-not-pdf",
            canDownloadOriginal: false,
            canCaptureViewer: true,
            signals: { ...emptySignals(candidate), signature: false },
          });
          continue;
        }
        const source: AcquiredPdfSource = {
          ...recovered,
          filename: candidate.filename,
          contentTypeSignal: false,
        };
        return this.persistAndDownload(tab, candidate, permission, artifactId, source);
      }
    }

    return (
      fallback ??
      capability(candidates[0], {
        status: "viewer-capture",
        permission: "granted",
        reason: "fetch-failed",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      })
    );
  }

  private async acquireDirect(
    candidate: PdfSourceCandidate,
    spoolId: string,
  ): Promise<AcquiredPdfSource | PdfSourceCapability | undefined> {
    let response: Response;
    try {
      response = await withTimeout(this.downloadTimeoutMs, (signal) =>
        this.fetcher.fetch(candidate.url.href, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          redirect: "follow",
          signal,
        }),
      );
    } catch {
      return capability(candidate, {
        status: "viewer-capture",
        permission: "granted",
        reason: "fetch-failed",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      });
    }

    if (response.status === 401 || response.status === 403) {
      return capability(candidate, {
        status: "auth-required",
        permission: "granted",
        reason: "auth-required",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      });
    }
    if (!response.ok || response.body === null) {
      return capability(candidate, {
        status: "viewer-capture",
        permission: "granted",
        reason: "fetch-failed",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      });
    }

    const finalUrl = (() => {
      try {
        return response.url.length > 0 ? new URL(response.url) : candidate.url;
      } catch {
        return candidate.url;
      }
    })();
    if (
      (finalUrl.protocol === "http:" || finalUrl.protocol === "https:") &&
      finalUrl.origin !== candidate.url.origin
    ) {
      const redirectedOrigin = `${finalUrl.origin}/*`;
      if (!(await this.permissions.containsOrigin(redirectedOrigin))) {
        return capability(
          { ...candidate, permissionOrigin: redirectedOrigin },
          {
            status: "original-passthrough",
            permission: "host-required",
            reason: "redirect-permission-required",
            canDownloadOriginal: true,
            canCaptureViewer: true,
          },
        );
      }
    }

    const expectedBytes = responseContentLength(response);
    const availableBytes = await this.spool.availableBytes();
    if (
      expectedBytes !== undefined &&
      availableBytes !== undefined &&
      expectedBytes > availableBytes
    ) {
      return capability(candidate, {
        status: "viewer-capture",
        permission: "granted",
        reason: "fetch-failed",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      });
    }

    let writer: PdfSourceSpoolWriter;
    try {
      writer = await this.spool.create(spoolId);
    } catch {
      return capability(candidate, {
        status: "viewer-capture",
        permission: "granted",
        reason: "fetch-failed",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      });
    }

    let streamed: StreamedPdfSource;
    try {
      streamed = await spoolPdfReadableStream(response.body, writer);
    } catch {
      return capability(candidate, {
        status: "viewer-capture",
        permission: "granted",
        reason: "fetch-failed",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      });
    }

    const contentTypeSignal = contentTypeIsPdf(response.headers.get("content-type"));
    if (!streamed.signature) {
      await writer.cleanup().catch(() => undefined);
      return capability(candidate, {
        status: contentTypeSignal ? "unsupported" : "viewer-capture",
        permission: "granted",
        reason: contentTypeSignal ? "pdf-invalid" : "response-not-pdf",
        canDownloadOriginal: false,
        canCaptureViewer: true,
        signals: {
          ...emptySignals(candidate),
          contentType: contentTypeSignal,
          signature: false,
        },
      });
    }

    return {
      ...streamed,
      filename:
        contentDispositionFilename(response.headers.get("content-disposition")) ?? candidate.filename,
      contentTypeSignal,
      cleanup: () => writer.cleanup(),
    };
  }

  private acquireCdp(
    candidate: PdfSourceCandidate,
    spoolId: string,
  ): Promise<RecoveredPdfSource | undefined> {
    if (this.cdpRecovery === undefined || candidate.scheme === "file") {
      return Promise.resolve(undefined);
    }
    return this.cdpRecovery.recover(candidate.tabId, candidate.url.href, `${spoolId}-cdp`);
  }

  private async persistAndDownload(
    tab: ActiveTabSnapshot,
    candidate: PdfSourceCandidate,
    permission: PdfSourceCapability["permission"],
    artifactId: string,
    source: AcquiredPdfSource,
  ): Promise<PdfOriginalDownload> {
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.artifactTtlMs);
    const geometry = await pdfGeometry(source.blob);
    const record: ArtifactRecord = {
      artifactId,
      sourceArtifactId: `pdf-source:${candidate.tabId}`,
      jobId: `pdf-source:${candidate.tabId}`,
      role: "output",
      format: "pdf",
      mimeType: "application/pdf",
      filename: source.filename,
      byteLength: source.byteLength,
      width: geometry.width,
      height: geometry.height,
      ...(geometry.pageCount === undefined ? {} : { pageCount: geometry.pageCount }),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      blob: source.blob,
      sourceTitle: tab.title ?? source.filename,
      sourceDomain: candidate.sourceLabel,
    };

    try {
      await this.artifacts.put(record);
    } finally {
      await source.cleanup().catch(() => undefined);
    }
    const downloadId = await this.downloads.download(record.artifactId);
    const finalCapability = capability(candidate, {
      status: "original-passthrough",
      permission,
      reason: "downloaded-original",
      canDownloadOriginal: true,
      canCaptureViewer: true,
      signals: {
        ...emptySignals(candidate),
        contentType: source.contentTypeSignal,
        signature: true,
      },
    });

    return {
      capability: finalCapability,
      artifact: {
        artifactId: record.artifactId,
        sourceArtifactId: record.sourceArtifactId,
        format: record.format,
        mimeType: record.mimeType,
        filename: record.filename,
        byteLength: record.byteLength,
        width: record.width,
        height: record.height,
        ...(record.pageCount === undefined ? {} : { pageCount: record.pageCount }),
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      },
      downloadId,
      checksumSha256: source.checksumSha256,
      originalByteLength: source.byteLength,
    };
  }
}

export const chromePdfSourcePermissions: PdfSourcePermissionPort = {
  containsOrigin: (origin) => chrome.permissions.contains({ origins: [origin] }),
  isFileAccessAllowed: () => chrome.extension.isAllowedFileSchemeAccess(),
};

export const browserPdfSourceFetcher: PdfSourceFetchPort = {
  fetch: (input, init) => globalThis.fetch(input, init),
};
