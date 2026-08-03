import { createChromeDebuggerAdapter } from "@background/chrome-debugger-adapter";
import { createChromeTabsAdapter } from "@background/chrome-tabs-adapter";
import { DebuggerClient } from "@background/debugger-client";
import { FullPageCaptureCoordinator } from "@background/full-page-capture-coordinator";
import { createChromePagePreparationAdapter } from "@background/page-preparation-adapter";
import { PagePreparationService } from "@background/page-preparation-service";
import { createChromeScrollCapturePageAdapter } from "@background/scroll-capture-page-adapter";
import {
  RegionSelectionService,
  createChromeRegionSelectionBrowserAdapter,
  type RegionSelectionPort,
} from "@background/region-selection-service";
import { CdpCaptureEngine } from "@capture/cdp-capture-engine";
import { ScrollCaptureEngine } from "@capture/scroll-capture-engine";
import { DEDUPE_RECORD_SCHEMA_VERSION, DEDUPE_TTL_MS } from "@shared/constants";
import type { CaptureJob } from "@shared/contracts/domain";
import type { StoredDedupeRecord } from "@shared/contracts/job";
import {
  JobActiveResponseMessageSchema,
  JobResponseMessageSchema,
  createJobActiveResponseMessage,
  createJobResponseMessage,
  parsePersistentJobRequest,
  type JobActiveResponseMessage,
  type JobResponseMessage,
  type PersistentJobRequest,
} from "@shared/contracts/job-messages";
import {
  createRegionSelectionEventAckMessage,
  isRegionSelectionEventType,
  parseRegionSelectionEvent,
  type RegionSelectionEventAckMessage,
} from "@shared/contracts/region-selection";
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

export type PersistentJobRouterResponse =
  JobResponseMessage | JobActiveResponseMessage | ErrorResponseMessage;

export type RegionSelectionRouterResponse = RegionSelectionEventAckMessage | ErrorResponseMessage;

export interface FullPageCapturePort {
  start(jobId: string): Promise<void>;
  cancel(jobId: string, reason?: string): Promise<CaptureJob>;
}

export interface PersistentJobRouterDependencies {
  jobs: PersistentJobCoordinatorPort;
  dedupe: DedupeRepositoryPort;
  now: () => Date;
  captures?: FullPageCapturePort;
  regions?: RegionSelectionPort;
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
        if (job.mode !== "full-page" && job.mode !== "region") {
          return;
        }
        if (job.mode === "region" && job.targetRect === undefined) {
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
  const regions = new RegionSelectionService(createChromeRegionSelectionBrowserAdapter());
  const dedupe = new IndexedDbDedupeRepository();
  sharedDependencies = { jobs, captures, regions, dedupe, now: () => new Date() };
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
  return (
    type === "JOB_CREATE" ||
    type === "JOB_GET" ||
    type === "JOB_GET_ACTIVE" ||
    type === "JOB_CANCEL"
  );
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
  const activeResponse = JobActiveResponseMessageSchema.safeParse(record.response);
  if (activeResponse.success) {
    return activeResponse.data;
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

type JobRequestResult =
  { kind: "job"; job: CaptureJob } | { kind: "active"; job: CaptureJob | null };

async function executeJobRequest(
  request: PersistentJobRequest,
  dependencies: PersistentJobRouterDependencies,
): Promise<JobRequestResult> {
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
      } else if (job.mode === "region" && dependencies.regions !== undefined) {
        try {
          await dependencies.regions.start(job.tabId, job.id);
        } catch (error) {
          await dependencies.jobs.cancel(job.id, "region selector failed to open");
          throw error;
        }
      }
      return { kind: "job", job };
    }
    case "JOB_GET": {
      const job = await dependencies.jobs.get(request.payload.jobId);
      if (job === undefined) {
        throw jobNotFound(request.payload.jobId);
      }
      return { kind: "job", job };
    }
    case "JOB_GET_ACTIVE": {
      return {
        kind: "active",
        job: (await dependencies.jobs.getActiveForTab?.(request.payload.tabId)) ?? null,
      };
    }
    case "JOB_CANCEL": {
      const job = await dependencies.jobs.get(request.payload.jobId);
      if (job === undefined) {
        throw jobNotFound(request.payload.jobId);
      }
      if (
        (job.mode === "full-page" || job.mode === "region") &&
        dependencies.captures !== undefined
      ) {
        return {
          kind: "job",
          job: await dependencies.captures.cancel(job.id, request.payload.reason),
        };
      }
      return {
        kind: "job",
        job: await dependencies.jobs.cancel(job.id, request.payload.reason),
      };
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

    const result = await executeJobRequest(parsed.value, dependencies);
    const response =
      result.kind === "active"
        ? createJobActiveResponseMessage({
            requestId: parsed.value.requestId,
            job: result.job,
            sentAt: dependencies.now().toISOString(),
          })
        : createJobResponseMessage({
            requestId: parsed.value.requestId,
            job: result.job,
            sentAt: dependencies.now().toISOString(),
          });
    await cacheResponse(
      parsed.value.type,
      parsed.value.requestId,
      result.job?.id,
      response,
      dependencies,
    );
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
    const jobId =
      parsed.value.type === "JOB_GET" || parsed.value.type === "JOB_CANCEL"
        ? parsed.value.payload.jobId
        : undefined;
    await cacheResponse(parsed.value.type, parsed.value.requestId, jobId, response, dependencies);
    return response;
  }
}

function senderTabId(sender: chrome.runtime.MessageSender): number | undefined {
  return sender.tab?.id;
}

export async function routeRegionSelectionMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  dependencies: PersistentJobRouterDependencies,
): Promise<RegionSelectionRouterResponse | undefined> {
  if (!isRegionSelectionEventType(message)) {
    return undefined;
  }
  const parsed = parseRegionSelectionEvent(message);
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
    const job = await dependencies.jobs.get(parsed.value.payload.jobId);
    const tabId = senderTabId(sender);
    if (
      job === undefined ||
      job.mode !== "region" ||
      job.state !== "created" ||
      tabId === undefined ||
      tabId !== job.tabId
    ) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_PROTOCOL_MESSAGE",
          stage: "protocol",
          message: "Region selection event does not match an active region job.",
          userMessageKey: "errors.regionSelection",
          retryable: false,
          fallbackAllowed: false,
          causeCode: "RegionSelectionJobMismatch",
          safeContext: {
            jobId: parsed.value.payload.jobId,
            ...(tabId === undefined ? {} : { tabId }),
          },
        }),
      );
    }

    if (parsed.value.type === "REGION_SELECTION_CANCEL") {
      await dependencies.jobs.cancel(
        job.id,
        parsed.value.payload.reason ?? "region selection cancelled",
      );
    } else {
      await dependencies.jobs.update(job.id, { targetRect: parsed.value.payload.rect });
      if (dependencies.captures === undefined) {
        throw createWebCapRuntimeError(
          createWebCapError({
            code: "E_PROTOCOL_MESSAGE",
            stage: "protocol",
            message: "The region capture coordinator is unavailable.",
            userMessageKey: "errors.regionSelection",
            retryable: true,
            fallbackAllowed: false,
            causeCode: "RegionCaptureCoordinatorMissing",
            safeContext: { jobId: job.id },
          }),
        );
      }
      void dependencies.captures.start(job.id).catch(() => undefined);
    }

    return createRegionSelectionEventAckMessage({
      requestId: parsed.value.requestId,
      jobId: job.id,
      accepted: true,
      sentAt: dependencies.now().toISOString(),
    });
  } catch (error) {
    return createErrorResponseMessage({
      requestId: parsed.value.requestId,
      error: normalizeError(error, {
        stage: parsed.value.type === "REGION_SELECTION_CANCEL" ? "cleanup" : "capture",
        userMessageKey: "errors.regionSelection",
        retryable: true,
        fallbackAllowed: false,
      }),
      sentAt: dependencies.now().toISOString(),
    });
  }
}

export function registerPersistentJobRouter(): void {
  const dependencies = defaultDependencies();
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (isRegionSelectionEventType(message)) {
        void routeRegionSelectionMessage(message, sender, dependencies).then((response) => {
          if (response !== undefined) {
            sendResponse(response);
          }
        });
        return true;
      }
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
