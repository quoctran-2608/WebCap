import { VISIBLE_CAPTURE_MIN_INTERVAL_MS } from "@shared/constants";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { VisibleCaptureMetadata } from "@shared/contracts/messages";
import {
  createWebCapError,
  createWebCapRuntimeError,
  type WebCapErrorData,
} from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

import { CaptureRateLimiter } from "./capture-rate-limiter";
import type { TabsCaptureAdapter } from "./chrome-tabs-adapter";
import { dataUrlToBlob } from "./data-url";
import { parsePngDataUrl } from "./png-metadata";
import { requireCapturableTab } from "./tab-capability";

export interface StoredVisibleCapture {
  metadata: VisibleCaptureMetadata;
  dataUrl: string;
}

export interface VisibleCaptureCoordinatorPort {
  start(requestId: string): Promise<VisibleCaptureMetadata>;
  cancel(requestId: string): boolean;
}

export interface VisibleCaptureCoordinatorOptions {
  tabs: TabsCaptureAdapter;
  artifacts?: ArtifactRepositoryPort;
  rateLimiter?: CaptureRateLimiter;
  createId?: () => string;
  now?: () => Date;
  sourceArtifactTtlMs?: number;
  completedRequestLimit?: number;
  preCancelledRequestLimit?: number;
}

interface CaptureCancellation {
  cancelled: boolean;
}

interface InFlightCapture {
  requestId: string;
  cancellation: CaptureCancellation;
  promise: Promise<VisibleCaptureMetadata>;
}

const DEFAULT_SOURCE_ARTIFACT_TTL_MS = 30 * 60 * 1000;

function cancelledError(): WebCapErrorData {
  return createWebCapError({
    code: "E_CANCELLED",
    stage: "capture",
    message: "Visible capture was cancelled.",
    userMessageKey: "errors.cancelled",
    retryable: true,
    fallbackAllowed: false,
  });
}

function normalizeCaptureFailure(error: unknown, tabId: number): WebCapErrorData {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const permissionFailure =
    message.includes("permission") ||
    message.includes("activetab") ||
    message.includes("not allowed");

  return normalizeError(error, {
    code: permissionFailure ? "E_PERMISSION_DENIED" : "E_CAPTURE_EMPTY",
    stage: permissionFailure ? "permission" : "capture",
    userMessageKey: permissionFailure ? "errors.permissionDenied" : "errors.captureFailed",
    retryable: true,
    fallbackAllowed: false,
    safeContext: { tabId },
  });
}

function busyError(): WebCapErrorData {
  return createWebCapError({
    code: "E_CAPTURE_RATE_LIMIT",
    stage: "capture",
    message: "Another visible capture is already running.",
    userMessageKey: "errors.captureRateLimit",
    retryable: true,
    fallbackAllowed: false,
  });
}

function rememberBounded<T>(map: Map<string, T>, key: string, value: T, limit: number): void {
  map.set(key, value);
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    map.delete(oldestKey);
  }
}

function rememberSetBounded(set: Set<string>, key: string, limit: number): void {
  set.add(key);
  while (set.size > limit) {
    const oldestKey = set.values().next().value;
    if (oldestKey === undefined) {
      break;
    }
    set.delete(oldestKey);
  }
}

export class VisibleCaptureCoordinator implements VisibleCaptureCoordinatorPort {
  private readonly tabs: TabsCaptureAdapter;
  private readonly artifacts: ArtifactRepositoryPort | undefined;
  private readonly rateLimiter: CaptureRateLimiter;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly sourceArtifactTtlMs: number;
  private readonly completedRequestLimit: number;
  private readonly preCancelledRequestLimit: number;
  private readonly completedRequests = new Map<string, VisibleCaptureMetadata>();
  private readonly captures = new Map<string, StoredVisibleCapture>();
  private readonly preCancelledRequests = new Set<string>();
  private inFlight: InFlightCapture | undefined;

  constructor(options: VisibleCaptureCoordinatorOptions) {
    this.tabs = options.tabs;
    this.artifacts = options.artifacts;
    this.rateLimiter =
      options.rateLimiter ??
      new CaptureRateLimiter({ minimumIntervalMs: VISIBLE_CAPTURE_MIN_INTERVAL_MS });
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.sourceArtifactTtlMs = options.sourceArtifactTtlMs ?? DEFAULT_SOURCE_ARTIFACT_TTL_MS;
    this.completedRequestLimit = options.completedRequestLimit ?? 16;
    this.preCancelledRequestLimit = options.preCancelledRequestLimit ?? 32;
  }

  start(requestId: string): Promise<VisibleCaptureMetadata> {
    const completed = this.completedRequests.get(requestId);
    if (completed !== undefined) {
      return Promise.resolve(completed);
    }

    if (this.inFlight !== undefined) {
      return this.inFlight.requestId === requestId
        ? this.inFlight.promise
        : Promise.reject(createWebCapRuntimeError(busyError()));
    }

    if (this.preCancelledRequests.delete(requestId)) {
      return Promise.reject(createWebCapRuntimeError(cancelledError()));
    }

    const cancellation: CaptureCancellation = { cancelled: false };
    const promise = this.execute(requestId, cancellation).finally(() => {
      if (this.inFlight?.requestId === requestId) {
        this.inFlight = undefined;
      }
    });
    this.inFlight = { requestId, cancellation, promise };
    return promise;
  }

  cancel(requestId: string): boolean {
    if (this.inFlight?.requestId === requestId) {
      this.inFlight.cancellation.cancelled = true;
      return true;
    }

    if (this.completedRequests.has(requestId)) {
      return false;
    }

    rememberSetBounded(this.preCancelledRequests, requestId, this.preCancelledRequestLimit);
    return true;
  }

  getCapture(captureId: string): StoredVisibleCapture | undefined {
    return this.captures.get(captureId);
  }

  releaseCapture(captureId: string): boolean {
    return this.captures.delete(captureId);
  }

  private async execute(
    requestId: string,
    cancellation: CaptureCancellation,
  ): Promise<VisibleCaptureMetadata> {
    if (cancellation.cancelled) {
      throw createWebCapRuntimeError(cancelledError());
    }

    const tabResult = await requireCapturableTab(this.tabs);
    if (!tabResult.ok) {
      throw createWebCapRuntimeError(tabResult.error);
    }

    try {
      const dataUrl = await this.rateLimiter.run(() => {
        if (cancellation.cancelled) {
          throw createWebCapRuntimeError(cancelledError());
        }
        return this.tabs.captureVisibleTab(tabResult.value.windowId);
      });

      if (cancellation.cancelled) {
        throw createWebCapRuntimeError(cancelledError());
      }

      const parsed = parsePngDataUrl(dataUrl);
      if (!parsed.ok) {
        throw createWebCapRuntimeError(parsed.error);
      }

      const metadata: VisibleCaptureMetadata = {
        captureId: this.createId(),
        tabId: tabResult.value.tabId,
        windowId: tabResult.value.windowId,
        ...parsed.value,
      };

      if (this.artifacts !== undefined) {
        const createdAt = this.now();
        const blob = dataUrlToBlob(dataUrl);
        const sourceRecord: ArtifactRecord = {
          artifactId: metadata.captureId,
          sourceArtifactId: metadata.captureId,
          jobId: metadata.captureId,
          role: "source",
          format: "png",
          mimeType: "image/png",
          filename: "webcap-source.png",
          byteLength: blob.size,
          width: metadata.width,
          height: metadata.height,
          createdAt: createdAt.toISOString(),
          expiresAt: new Date(createdAt.getTime() + this.sourceArtifactTtlMs).toISOString(),
          blob,
          ...(tabResult.value.title === undefined ? {} : { sourceTitle: tabResult.value.title }),
          ...(tabResult.value.domain === undefined ? {} : { sourceDomain: tabResult.value.domain }),
        };
        await this.artifacts.put(sourceRecord);
      }

      this.captures.set(metadata.captureId, { metadata, dataUrl });
      rememberBounded(this.completedRequests, requestId, metadata, this.completedRequestLimit);
      return metadata;
    } catch (error) {
      throw createWebCapRuntimeError(normalizeCaptureFailure(error, tabResult.value.tabId));
    }
  }
}
