import { PDFDocument } from "pdf-lib";

import type { ActiveTabSnapshot, TabsCaptureAdapter } from "./chrome-tabs-adapter";
import {
  ORIGINAL_PDF_MAX_BYTES,
  PDF_SOURCE_DOWNLOAD_TIMEOUT_MS,
  PDF_SOURCE_PROBE_TIMEOUT_MS,
} from "@shared/constants";
import type { DownloadService } from "./download-service";
import {
  contentDispositionFilename,
  contentTypeIsPdf,
  hasPdfHeader,
  resolvePdfSourceCandidate,
  type PdfSourceCandidate,
} from "./pdf-source-detection";
import type {
  PdfOriginalDownload,
  PdfSourceCapability,
  PdfSourceSignals,
} from "@shared/contracts/pdf-source";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

const DEFAULT_ARTIFACT_TTL_MS = 30 * 60 * 1000;

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
  now?: () => Date;
  createId?: () => string;
  artifactTtlMs?: number;
  probeTimeoutMs?: number;
  downloadTimeoutMs?: number;
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

function sizeLimitError(byteLength: number): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_MEMORY_GUARD",
      stage: "export",
      message: "The original PDF exceeds WebCap's safe local passthrough limit.",
      userMessageKey: "errors.pdfSourceTooLarge",
      retryable: false,
      fallbackAllowed: true,
      causeCode: "PdfSourceTooLarge",
      safeContext: { byteLength, maxByteLength: ORIGINAL_PDF_MAX_BYTES },
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function readGuarded(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > ORIGINAL_PDF_MAX_BYTES) {
    throw sizeLimitError(contentLength);
  }

  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > ORIGINAL_PDF_MAX_BYTES) throw sizeLimitError(bytes.byteLength);
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > ORIGINAL_PDF_MAX_BYTES) {
        await reader.cancel();
        throw sizeLimitError(total);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function pdfGeometry(bytes: Uint8Array): Promise<{
  width: number;
  height: number;
  pageCount?: number;
}> {
  try {
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
    return { width: 1, height: 1 };
  }
}

export class PdfSourceService {
  private readonly tabs: Pick<TabsCaptureAdapter, "queryActiveTab">;
  private readonly permissions: PdfSourcePermissionPort;
  private readonly fetcher: PdfSourceFetchPort;
  private readonly artifacts: ArtifactRepositoryPort;
  private readonly downloads: Pick<DownloadService, "download">;
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
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.artifactTtlMs = options.artifactTtlMs ?? DEFAULT_ARTIFACT_TTL_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? PDF_SOURCE_PROBE_TIMEOUT_MS;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? PDF_SOURCE_DOWNLOAD_TIMEOUT_MS;
  }

  async inspect(): Promise<PdfSourceCapability> {
    const tab = await this.tabs.queryActiveTab();
    if (tab === undefined || !tab.active) return unsupportedCapability(tab);
    const candidate = resolvePdfSourceCandidate({
      tabId: tab.id,
      ...(tab.url === undefined ? {} : { tabUrl: tab.url }),
    });
    if (candidate === undefined) return unsupportedCapability(tab);

    const permission = await permissionState(candidate, this.permissions);
    if (permission !== "granted") {
      return candidate.urlExtensionSignal || candidate.chromePdfViewerSignal
        ? capability(candidate, {
            status: "original-passthrough",
            permission,
            reason:
              permission === "file-access-required" ? "file-access-disabled" : "permission-missing",
            canDownloadOriginal: true,
            canCaptureViewer: candidate.canCaptureViewer,
          })
        : capability(candidate, {
            status: "not-pdf",
            permission,
            reason: "not-pdf-url",
            canDownloadOriginal: false,
            canCaptureViewer: candidate.canCaptureViewer,
          });
    }

    if (candidate.scheme === "file") {
      return candidate.urlExtensionSignal
        ? capability(candidate, {
            status: "original-passthrough",
            permission,
            reason: "url-extension",
            canDownloadOriginal: true,
            canCaptureViewer: true,
          })
        : capability(candidate, {
            status: "not-pdf",
            permission,
            reason: "not-pdf-url",
            canDownloadOriginal: false,
            canCaptureViewer: true,
          });
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
        return capability(candidate, {
          status: "auth-required",
          permission,
          reason: "auth-required",
          canDownloadOriginal: false,
          canCaptureViewer: true,
        });
      }
      const contentTypeSignal = contentTypeIsPdf(response.headers.get("content-type"));
      const signals = { ...emptySignals(candidate), contentType: contentTypeSignal };
      if (contentTypeSignal || candidate.urlExtensionSignal || candidate.chromePdfViewerSignal) {
        return capability(candidate, {
          status: "original-passthrough",
          permission,
          reason: contentTypeSignal ? "content-type" : "url-extension",
          canDownloadOriginal: true,
          canCaptureViewer: true,
          signals,
        });
      }
      return capability(candidate, {
        status: "not-pdf",
        permission,
        reason: "not-pdf-url",
        canDownloadOriginal: false,
        canCaptureViewer: true,
        signals,
      });
    } catch {
      if (candidate.urlExtensionSignal || candidate.chromePdfViewerSignal) {
        return capability(candidate, {
          status: "original-passthrough",
          permission,
          reason: candidate.chromePdfViewerSignal ? "chrome-pdf-viewer" : "url-extension",
          canDownloadOriginal: true,
          canCaptureViewer: true,
        });
      }
      return capability(candidate, {
        status: "not-pdf",
        permission,
        reason: "not-pdf-url",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      });
    }
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

  private async processDownload(
    expectedTabId: number,
  ): Promise<PdfOriginalDownload | PdfSourceCapability> {
    const tab = await this.tabs.queryActiveTab();
    if (tab === undefined || !tab.active || tab.id !== expectedTabId) throw sourceChangedError();
    const candidate = resolvePdfSourceCandidate({
      tabId: tab.id,
      ...(tab.url === undefined ? {} : { tabUrl: tab.url }),
    });
    if (candidate === undefined) return unsupportedCapability(tab);

    const permission = await permissionState(candidate, this.permissions);
    if (permission !== "granted") {
      return capability(candidate, {
        status: "original-passthrough",
        permission,
        reason:
          permission === "file-access-required" ? "file-access-disabled" : "permission-missing",
        canDownloadOriginal: true,
        canCaptureViewer: true,
      });
    }

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
        permission,
        reason: "fetch-failed",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      });
    }

    if (response.status === 401 || response.status === 403) {
      return capability(candidate, {
        status: "auth-required",
        permission,
        reason: "auth-required",
        canDownloadOriginal: false,
        canCaptureViewer: true,
      });
    }
    if (!response.ok) {
      return capability(candidate, {
        status: "viewer-capture",
        permission,
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
    if (finalUrl.origin !== candidate.url.origin && finalUrl.protocol !== "file:") {
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

    const bytes = await readGuarded(response);
    const contentTypeSignal = contentTypeIsPdf(response.headers.get("content-type"));
    const signatureSignal = hasPdfHeader(bytes);
    const signals: PdfSourceSignals = {
      ...emptySignals(candidate),
      contentType: contentTypeSignal,
      signature: signatureSignal,
    };
    if (!signatureSignal) {
      return capability(candidate, {
        status: contentTypeSignal ? "unsupported" : "viewer-capture",
        permission,
        reason: contentTypeSignal ? "pdf-invalid" : "response-not-pdf",
        canDownloadOriginal: false,
        canCaptureViewer: true,
        signals,
      });
    }

    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.artifactTtlMs);
    const artifactId = this.createId();
    const filename =
      contentDispositionFilename(response.headers.get("content-disposition")) ?? candidate.filename;
    const blob = new Blob([Uint8Array.from(bytes).buffer], { type: "application/pdf" });
    const geometry = await pdfGeometry(bytes);
    const record: ArtifactRecord = {
      artifactId,
      sourceArtifactId: `pdf-source:${candidate.tabId}`,
      jobId: `pdf-source:${candidate.tabId}`,
      role: "output",
      format: "pdf",
      mimeType: "application/pdf",
      filename,
      byteLength: blob.size,
      width: geometry.width,
      height: geometry.height,
      ...(geometry.pageCount === undefined ? {} : { pageCount: geometry.pageCount }),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      blob,
      sourceTitle: tab.title ?? filename,
      sourceDomain: candidate.sourceLabel,
    };
    await this.artifacts.put(record);
    const downloadId = await this.downloads.download(record.artifactId);
    const checksumSha256 = await sha256Hex(bytes);
    const finalCapability = capability(candidate, {
      status: "original-passthrough",
      permission,
      reason: "downloaded-original",
      canDownloadOriginal: true,
      canCaptureViewer: true,
      signals,
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
      checksumSha256,
      originalByteLength: bytes.byteLength,
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
