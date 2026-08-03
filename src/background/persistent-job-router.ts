import { createChromeDebuggerAdapter } from "@background/chrome-debugger-adapter";
import { createChromeTabsAdapter } from "@background/chrome-tabs-adapter";
import { DebuggerClient } from "@background/debugger-client";
import { FullPageCaptureCoordinator } from "@background/full-page-capture-coordinator";
import { createChromePagePreparationAdapter } from "@background/page-preparation-adapter";
import { PagePreparationService } from "@background/page-preparation-service";
import { createChromeScrollCapturePageAdapter } from "@background/scroll-capture-page-adapter";
import { CdpCaptureEngine } from "@capture/cdp-capture-engine";
import { ScrollCaptureEngine } from "@capture/scroll-capture-engine";
import { DEDUPE_RECORD_SCHEMA_VERSION, DEDUPE_TTL_MS } from "@shared/constants";
import type { CaptureJob } from "@shared/contracts/domain";
import type { StoredDedupeRecord } from "@shared/contracts/job";
import {
  JobResponseMessageSchema,
  createJobResponseMessage,
  parsePersistentJobRequest,
  type JobResponseMessage,
  type PersistentJobRequest,
} from "@shared/contracts/job-messages";
import {
  ErrorResponseMessageSchema,
  createErrorResponseMessage,
  type ErrorResponseMessage,
} from "@shared/contracts/messages";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import { IndexedDbDedupeRepository, type DedupeRepositoryPort } from "@storage/dedupe-repository";
import { IndexedDbJobArtifactCleanupRepository } from "@storage/job-artifact-cleanup-repository";
import { IndexedDbJobRepository } from "@storage/job-repository";
import { JobSessionRepository } from "@storage/job-session-repository";
import { IndexedDbTileRepository } from "@storage/tile-repository";

import { PersistentJobCoordinator, type PersistentJobCoordinatorPort } from "./job-coordinator";

export type PersistentJobRouterResponse = JobResponseMessage | ErrorResponseMessage;

export interface FullPageCapturePort {
  start(jobId: string): Promise<void>;
  cancel(jobId: string, reason?: string): Promise<CaptureJob>;
}

export interface PersistentJobRouterDependencies {
  jobs: PersistentJobCoordinatorPort;
  dedupe: DedupeRepositoryPort;
  now: () => Date;
  captures?: FullPageCapturePort;
}

let sharedDependencies: PersistentJobRouterDependencies | undefined;

function addMilliseconds(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function defaultDependencies(): PersistentJobRouterDependencies {
  if (sharedDependencies !== undefined) {
    return sharedDependencies;
  }

  const jobRepository = new IndexedDbJobRepository();
  const sessions = new JobSessionRepository();
  const tiles = new IndexedDbTileRepository();
  const pages = new PagePreparationService({
    browser: createChromePagePreparationAdapter(),
  });
  const scrollPages = createChromeScrollCapturePageAdapter();
  const tabs = createChromeTabsAdapter();
  const jobs = new PersistentJobCoordinator({
    jobs: jobRepository,
    sessions,
    tiles,
    artifacts: new IndexedDbJobArtifactCleanupRepository(),
    cleanup: {
      async cleanup(job) {
        if (job.mode !== "full-page") {
          return;
        }
        let scrollCleanupError: unknown;
        try {
          await scrollPages.cleanup(job.tabId, job.id, 0, 0);
        } catch (error) {
          scrollCleanupError = error;
        }
        let pageCleanupError: unknown;
        try {
          await pages.restore(job.tabId, job.id);
        } catch (error) {
          pageCleanupError = error;
        }
        if (scrollCleanupError instanceof Error) {
          throw scrollCleanupError;
        }
        if (pageCleanupError instanceof Error) {
          throw pageCleanupError;
        }
      },
    },
  });
  const captures = new FullPageCaptureCoordinator({
    jobs,
    pages,
    tiles,
    engine: new CdpCaptureEngine(new DebuggerClient(createChromeDebuggerAdapter())),
    fallbackEngine: new ScrollCaptureEngine({ pages: scrollPages, tabs }),
  });
  const dedupe = new IndexedDbDedupeRepository();
  sharedDependencies = { jobs, captures, dedupe, now: () => new Date() };
  const nowIso = new Date().toISOString();
  void Promise.allSettled([jobs.initialize(), dedupe.deleteExpired(nowIso)]);
  return sharedDependencies;
}

function requestIdFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("requestId" in value)) {
    return undefined;
  }
  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}

export function isPersistentJobMessageType(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "JOB_CREATE" || type === "JOB_GET" || type === "JOB_CANCEL";
}

function targetsBackground(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "target" in value &&
    (value as { target?: unknown }).target === "background"
  );
}

function jobNotFound(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The requested capture job does not exist.",
      userMessageKey: "errors.jobNotFound",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "JobNotFound",
      safeContext: { jobId },
    }),
  );
}

async function readCachedResponse(
  requestId: string,
  dependencies: PersistentJobRouterDependencies,
): Promise<PersistentJobRouterResponse | undefined> {
  const record = await dependencies.dedupe.get(requestId, dependencies.now().toISOString());
  if (record === undefined) {
    return undefined;
  }

  const jobResponse = JobResponseMessageSchema.safeParse(record.response);
  if (jobResponse.success) {
    return jobResponse.data;
  }
  const errorResponse = ErrorResponseMessageSchema.safeParse(record.response);
  return errorResponse.success ? errorResponse.data : undefined;
}

async function cacheResponse(
  requestType: string,
  requestId: string,
  jobId: string | undefined,
  response: PersistentJobRouterResponse,
  dependencies: PersistentJobRouterDependencies,
): Promise<void> {
  const now = dependencies.now();
  const record: StoredDedupeRecord = {
    schemaVersion: DEDUPE_RECORD_SCHEMA_VERSION,
    requestId,
    requestType,
    response,
    createdAt: now.toISOString(),
    expiresAt: addMilliseconds(now, DEDUPE_TTL_MS),
    ...(jobId === undefined ? {} : { jobId }),
  };
  try {
    await dependencies.dedupe.put(record);
  } catch {
    // The job result remains authoritative even when the short-lived dedupe cache is unavailable.
  }
}

async function executeJobRequest(
  request: PersistentJobRequest,
  dependencies: PersistentJobRouterDependencies,
): Promise<CaptureJob> {
  switch (request.type) {
    case "JOB_CREATE": {
      const job = await dependencies.jobs.create({
        tabId: request.payload.tabId,
        windowId: request.payload.windowId,
        mode: request.payload.mode,
        settings: request.payload.settings,
        ...(request.payload.preferredEngine === undefined
          ? {}
          : { preferredEngine: request.payload.preferredEngine }),
        ...(request.payload.source === undefined
          ? {}
          : {
              source: {
                ...(request.payload.source.title === undefined
                  ? {}
                  : { title: request.payload.source.title }),
                ...(request.payload.source.origin === undefined
                  ? {}
                  : { origin: request.payload.source.origin }),
              },
            }),
      });
      if (job.mode === "full-page" && dependencies.captures !== undefined) {
        void dependencies.captures.start(job.id).catch(() => undefined);
      }
      return job;
    }
    case "JOB_GET": {
      const job = await dependencies.jobs.get(request.payload.jobId);
      if (job === undefined) {
        throw jobNotFound(request.payload.jobId);
      }
      return job;
    }
    case "JOB_CANCEL": {
      const job = await dependencies.jobs.get(request.payload.jobId);
      if (job === undefined) {
        throw jobNotFound(request.payload.jobId);
      }
      if (job.mode === "full-page" && dependencies.captures !== undefined) {
        return dependencies.captures.cancel(job.id, request.payload.reason);
      }
      return dependencies.jobs.cancel(job.id, request.payload.reason);
    }
  }
}

export async function routePersistentJobMessage(
  message: unknown,
  dependencies: PersistentJobRouterDependencies,
): Promise<PersistentJobRouterResponse | undefined> {
  if (!isPersistentJobMessageType(message) || !targetsBackground(message)) {
    return undefined;
  }

  const parsed = parsePersistentJobRequest(message);
  if (!parsed.ok) {
    const requestId = requestIdFrom(message);
    if (requestId === undefined) {
      return undefined;
    }
    return createErrorResponseMessage({
      requestId,
      error: parsed.error,
      sentAt: dependencies.now().toISOString(),
    });
  }

  try {
    const cached = await readCachedResponse(parsed.value.requestId, dependencies);
    if (cached !== undefined) {
      return cached;
    }

    const job = await executeJobRequest(parsed.value, dependencies);
    const response = createJobResponseMessage({
      requestId: parsed.value.requestId,
      job,
      sentAt: dependencies.now().toISOString(),
    });
    await cacheResponse(parsed.value.type, parsed.value.requestId, job.id, response, dependencies);
    return response;
  } catch (error) {
    const normalized = normalizeError(error, {
      stage: parsed.value.type === "JOB_CANCEL" ? "cleanup" : "storage",
      userMessageKey: parsed.value.type === "JOB_CANCEL" ? "errors.jobCancel" : "errors.jobCommand",
      retryable: true,
      fallbackAllowed: false,
    });
    const response = createErrorResponseMessage({
      requestId: parsed.value.requestId,
      error: normalized,
      sentAt: dependencies.now().toISOString(),
    });
    const jobId = parsed.value.type === "JOB_CREATE" ? undefined : parsed.value.payload.jobId;
    await cacheResponse(parsed.value.type, parsed.value.requestId, jobId, response, dependencies);
    return response;
  }
}

export function registerPersistentJobRouter(): void {
  const dependencies = defaultDependencies();
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (!isPersistentJobMessageType(message) || !targetsBackground(message)) {
        return false;
      }
      void routePersistentJobMessage(message, dependencies).then((response) => {
        if (response !== undefined) {
          sendResponse(response);
        }
      });
      return true;
    },
  );
}
