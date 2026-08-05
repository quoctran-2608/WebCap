import { createChromeDebuggerAdapter } from "@background/chrome-debugger-adapter";
import {
  ElementSelectionService,
  createChromeElementSelectionBrowserAdapter,
  type ElementSelectionPort,
  type ElementTargetValidationPort,
} from "@background/element-selection-service";
import { createChromeTabsAdapter } from "@background/chrome-tabs-adapter";
import { DebuggerClient } from "@background/debugger-client";
import { FullPageCaptureCoordinator } from "@background/full-page-capture-coordinator";
import { createChromePagePreparationAdapter } from "@background/page-preparation-adapter";
import { PagePreparationService } from "@background/page-preparation-service";
import { OffscreenService } from "@background/offscreen-service";
import { PdfExportService } from "@background/pdf-export-service";
import {
  ChromeScrollAreaPageAdapter,
  type ScrollAreaPageAdapter,
} from "@background/scroll-area-page-adapter";
import { createChromeScrollCapturePageAdapter } from "@background/scroll-capture-page-adapter";
import {
  RegionSelectionService,
  createChromeRegionSelectionBrowserAdapter,
  type RegionSelectionPort,
} from "@background/region-selection-service";
import { CdpCaptureEngine } from "@capture/cdp-capture-engine";
import { ScrollAreaCaptureEngine } from "@capture/scroll-area-capture-engine";
import { ScrollCaptureEngine } from "@capture/scroll-capture-engine";
import { DEDUPE_RECORD_SCHEMA_VERSION, DEDUPE_TTL_MS } from "@shared/constants";
import {
  CaptureResetResponseSchema,
  createCaptureResetRequest,
  createCaptureResetResponse,
  type CaptureResetReport,
  type CaptureResetResponse,
} from "@shared/contracts/capture-reset";
import type { CaptureJob } from "@shared/contracts/domain";
import type { StoredDedupeRecord } from "@shared/contracts/job";
import {
  createOffscreenPdfExportProgressAckMessage,
  isOffscreenPdfExportProgressMessage,
  type OffscreenPdfExportProgressAckMessage,
} from "@shared/contracts/offscreen";
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
  createElementSelectionEventAckMessage,
  isElementSelectionEventType,
  parseElementSelectionEvent,
  type ElementSelectionEventAckMessage,
} from "@shared/contracts/element-selection";
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
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";
import { IndexedDbJobArtifactCleanupRepository } from "@storage/job-artifact-cleanup-repository";
import { IndexedDbJobRepository } from "@storage/job-repository";
import { JobSessionRepository } from "@storage/job-session-repository";
import { PdfEditManifestRepository } from "@storage/pdf-edit-manifest-repository";
import { IndexedDbTileRepository } from "@storage/tile-repository";

import { CaptureOwnedDataCleanupService } from "./capture-data-cleanup-service";
import { CaptureResetService } from "./capture-reset-service";
import { PersistentJobCoordinator, type PersistentJobCoordinatorPort } from "./job-coordinator";
import { getMessageRouterDependencies } from "./message-router";

export type PersistentJobRouterResponse =
  JobResponseMessage | JobActiveResponseMessage | CaptureResetResponse | ErrorResponseMessage;

export type RegionSelectionRouterResponse = RegionSelectionEventAckMessage | ErrorResponseMessage;
export type ElementSelectionRouterResponse = ElementSelectionEventAckMessage | ErrorResponseMessage;
export type PdfProgressRouterResponse = OffscreenPdfExportProgressAckMessage;

export interface FullPageCapturePort {
  start(jobId: string): Promise<void>;
  cancel(
    jobId: string,
    reason?: string,
    disposition?: "discard" | "keep-partial",
  ): Promise<CaptureJob>;
  waitForIdle?(jobId: string): Promise<void>;
}

export interface PdfExportPort {
  start(jobId: string, settings?: CaptureJob["settings"]["pdf"]): Promise<CaptureJob>;
  cancel(jobId: string): Promise<CaptureJob>;
  waitForIdle?(jobId: string): Promise<void>;
  handleProgress(progress: {
    jobId: string;
    completedPages: number;
    totalPages: number;
  }): Promise<CaptureJob | undefined>;
}

export interface PersistentJobRouterDependencies {
  jobs: PersistentJobCoordinatorPort;
  dedupe: DedupeRepositoryPort;
  now: () => Date;
  captures?: FullPageCapturePort;
  scrollAreaCaptures?: FullPageCapturePort;
  regions?: RegionSelectionPort;
  elements?: ElementSelectionPort & ElementTargetValidationPort;
  pdfExports?: PdfExportPort;
  reset?: Pick<CaptureResetService, "reset">;
}

let sharedDependencies: PersistentJobRouterDependencies | undefined;

function addMilliseconds(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

export function getPersistentJobRouterDependencies(): PersistentJobRouterDependencies {
  if (sharedDependencies !== undefined) {
    return sharedDependencies;
  }

  const jobRepository = new IndexedDbJobRepository();
  const sessions = new JobSessionRepository();
  const tiles = new IndexedDbTileRepository();
  const jobArtifacts = new IndexedDbJobArtifactCleanupRepository();
  const manifests = new PdfEditManifestRepository();
  const ownedDataCleanup = new CaptureOwnedDataCleanupService({
    jobs: jobRepository,
    sessions,
    tiles,
    artifacts: jobArtifacts,
    manifests,
  });
  const pages = new PagePreparationService({
    browser: createChromePagePreparationAdapter(),
  });
  const scrollPages = createChromeScrollCapturePageAdapter();
  const scrollAreaPages: ScrollAreaPageAdapter = new ChromeScrollAreaPageAdapter();
  const tabs = createChromeTabsAdapter();
  const jobs = new PersistentJobCoordinator({
    jobs: jobRepository,
    sessions,
    tiles,
    artifacts: jobArtifacts,
    ownedDataCleanup,
    cleanup: {
      async cleanup(job) {
        if (job.mode === "scroll-area") {
          if (job.targetDescriptor === undefined) return;
          await scrollAreaPages.cleanup(job.tabId, job.id, job.targetDescriptor);
          return;
        }
        if (job.mode !== "full-page" && job.mode !== "region" && job.mode !== "element") {
          return;
        }
        if ((job.mode === "region" || job.mode === "element") && job.targetRect === undefined) {
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
        if (scrollCleanupError instanceof Error) throw scrollCleanupError;
        if (pageCleanupError instanceof Error) throw pageCleanupError;
      },
    },
  });
  const elements = new ElementSelectionService(createChromeElementSelectionBrowserAdapter());
  const captures = new FullPageCaptureCoordinator({
    jobs,
    pages,
    tiles,
    engine: new CdpCaptureEngine(new DebuggerClient(createChromeDebuggerAdapter())),
    fallbackEngine: new ScrollCaptureEngine({ pages: scrollPages, tabs }),
    targetValidator: elements,
  });
  const scrollAreaCaptures = new FullPageCaptureCoordinator({
    jobs,
    tiles,
    preparePage: false,
    engine: new ScrollAreaCaptureEngine({ pages: scrollAreaPages, tabs }),
    targetValidator: elements,
  });
  const regions = new RegionSelectionService(createChromeRegionSelectionBrowserAdapter());
  const artifacts = new IndexedDbArtifactRepository();
  const pdfExports = new PdfExportService({
    jobs,
    tiles,
    offscreen: new OffscreenService(),
    manifests,
    artifacts,
  });
  const visible = getMessageRouterDependencies();
  if (
    visible.visibleSessions === undefined ||
    visible.artifacts === undefined ||
    visible.artifactsByJob === undefined
  ) {
    throw new Error("Visible capture reset dependencies are unavailable.");
  }
  const reset = new CaptureResetService({
    jobs,
    cleanup: ownedDataCleanup,
    captures,
    scrollAreaCaptures,
    pdfExports,
    regionSelections: regions,
    elementSelections: elements,
    visibleSessions: visible.visibleSessions,
    visibleCapture: visible.visibleCapture,
    imageExport: visible.imageExport,
    artifacts: visible.artifacts,
    artifactsByJob: visible.artifactsByJob,
  });
  const dedupe = new IndexedDbDedupeRepository();
  sharedDependencies = {
    jobs,
    captures,
    scrollAreaCaptures,
    regions,
    elements,
    pdfExports,
    reset,
    dedupe,
    now: () => new Date(),
  };
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
    type === "JOB_CANCEL" ||
    type === "PDF_EXPORT_START" ||
    type === "CAPTURE_RESET"
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
  const resetResponse = CaptureResetResponseSchema.safeParse(record.response);
  if (resetResponse.success) {
    return resetResponse.data;
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
  | { kind: "job"; job: CaptureJob }
  | { kind: "active"; job: CaptureJob | null }
  | { kind: "reset"; report: CaptureResetReport };

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
          if (dependencies.reset !== undefined) {
            try {
              await dependencies.reset.reset(
                createCaptureResetRequest({
                  requestId: crypto.randomUUID(),
                  sentAt: dependencies.now().toISOString(),
                  scope: "job",
                  jobId: job.id,
                }),
              );
            } catch {
              await dependencies.jobs
                .cancel(job.id, "region selector failed to open")
                .catch(() => undefined);
            }
          } else {
            await dependencies.jobs.cancel(job.id, "region selector failed to open");
          }
          throw error;
        }
      } else if (job.mode === "element" && dependencies.elements !== undefined) {
        try {
          await dependencies.elements.start(job.tabId, job.id, "visible-bounds");
        } catch (error) {
          await dependencies.jobs.cancel(job.id, "element selector failed to open");
          throw error;
        }
      } else if (job.mode === "scroll-area" && dependencies.elements !== undefined) {
        try {
          await dependencies.elements.start(job.tabId, job.id, "full-scroll-content");
        } catch (error) {
          await dependencies.jobs.cancel(job.id, "scroll-area selector failed to open");
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
    case "PDF_EXPORT_START": {
      if (dependencies.pdfExports === undefined) {
        throw createWebCapRuntimeError(
          createWebCapError({
            code: "E_OFFSCREEN_UNAVAILABLE",
            stage: "export",
            message: "The PDF export coordinator is unavailable.",
            userMessageKey: "errors.offscreenUnavailable",
            retryable: true,
            fallbackAllowed: false,
            causeCode: "PdfExportCoordinatorMissing",
          }),
        );
      }
      return {
        kind: "job",
        job: await dependencies.pdfExports.start(request.payload.jobId, request.payload.settings),
      };
    }
    case "CAPTURE_RESET": {
      if (dependencies.reset === undefined) {
        throw createWebCapRuntimeError(
          createWebCapError({
            code: "E_CLEANUP_PARTIAL",
            stage: "cleanup",
            message: "The capture reset service is unavailable.",
            userMessageKey: "errors.cleanupPartial",
            retryable: true,
            fallbackAllowed: false,
            causeCode: "CaptureResetServiceMissing",
          }),
        );
      }
      return { kind: "reset", report: await dependencies.reset.reset(request) };
    }
    case "JOB_CANCEL": {
      const job = await dependencies.jobs.get(request.payload.jobId);
      if (job === undefined) {
        throw jobNotFound(request.payload.jobId);
      }
      if (job.mode === "scroll-area" && dependencies.scrollAreaCaptures !== undefined) {
        return {
          kind: "job",
          job: await dependencies.scrollAreaCaptures.cancel(
            job.id,
            request.payload.reason,
            request.payload.disposition,
          ),
        };
      }
      if (
        (job.mode === "full-page" || job.mode === "region" || job.mode === "element") &&
        dependencies.captures !== undefined
      ) {
        return {
          kind: "job",
          job: await dependencies.captures.cancel(
            job.id,
            request.payload.reason,
            request.payload.disposition,
          ),
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
        : result.kind === "reset"
          ? createCaptureResetResponse({
              requestId: parsed.value.requestId,
              target: parsed.value.source,
              report: result.report,
              sentAt: dependencies.now().toISOString(),
            })
          : createJobResponseMessage({
              requestId: parsed.value.requestId,
              job: result.job,
              sentAt: dependencies.now().toISOString(),
            });
    const responseJobId =
      result.kind === "job"
        ? result.job.id
        : result.kind === "active"
          ? result.job?.id
          : result.report.jobId;
    await cacheResponse(
      parsed.value.type,
      parsed.value.requestId,
      responseJobId,
      response,
      dependencies,
    );
    return response;
  } catch (error) {
    const normalized = normalizeError(error, {
      stage:
        parsed.value.type === "JOB_CANCEL" || parsed.value.type === "CAPTURE_RESET"
          ? "cleanup"
          : "storage",
      userMessageKey:
        parsed.value.type === "JOB_CANCEL" || parsed.value.type === "CAPTURE_RESET"
          ? "errors.jobCancel"
          : "errors.jobCommand",
      retryable: true,
      fallbackAllowed: false,
    });
    const response = createErrorResponseMessage({
      requestId: parsed.value.requestId,
      error: normalized,
      sentAt: dependencies.now().toISOString(),
    });
    const jobId =
      parsed.value.type === "JOB_GET" ||
      parsed.value.type === "JOB_CANCEL" ||
      parsed.value.type === "PDF_EXPORT_START"
        ? parsed.value.payload.jobId
        : parsed.value.type === "CAPTURE_RESET" && parsed.value.payload.scope === "job"
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

export async function routeElementSelectionMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  dependencies: PersistentJobRouterDependencies,
): Promise<ElementSelectionRouterResponse | undefined> {
  if (!isElementSelectionEventType(message)) {
    return undefined;
  }
  const parsed = parseElementSelectionEvent(message);
  if (!parsed.ok) {
    const requestId = requestIdFrom(message);
    return requestId === undefined
      ? undefined
      : createErrorResponseMessage({
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
      (job.mode !== "element" && job.mode !== "scroll-area") ||
      job.state !== "created" ||
      tabId === undefined ||
      tabId !== job.tabId
    ) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_PROTOCOL_MESSAGE",
          stage: "protocol",
          message: "Element selection event does not match an active element job.",
          userMessageKey: "errors.elementSelection",
          retryable: false,
          fallbackAllowed: false,
          causeCode: "ElementSelectionJobMismatch",
          safeContext: {
            jobId: parsed.value.payload.jobId,
            ...(tabId === undefined ? {} : { tabId }),
          },
        }),
      );
    }

    if (
      parsed.value.type === "ELEMENT_SELECTION_COMMIT" &&
      parsed.value.payload.descriptor.captureKind !==
        (job.mode === "scroll-area" ? "full-scroll-content" : "visible-bounds")
    ) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_PROTOCOL_MESSAGE",
          stage: "protocol",
          message: "Selected target kind does not match the active capture mode.",
          userMessageKey: "errors.elementSelection",
          retryable: false,
          fallbackAllowed: false,
          causeCode: "ElementSelectionCaptureKindMismatch",
          safeContext: { jobId: job.id },
        }),
      );
    }

    if (parsed.value.type === "ELEMENT_SELECTION_CANCEL") {
      await dependencies.jobs.cancel(
        job.id,
        parsed.value.payload.reason ?? "element selection cancelled",
      );
    } else {
      await dependencies.jobs.update(job.id, {
        targetRect: parsed.value.payload.rect,
        targetDescriptor: parsed.value.payload.descriptor,
      });
      const coordinator =
        job.mode === "scroll-area" ? dependencies.scrollAreaCaptures : dependencies.captures;
      if (coordinator === undefined) {
        throw createWebCapRuntimeError(
          createWebCapError({
            code: "E_PROTOCOL_MESSAGE",
            stage: "protocol",
            message: "The selected-target capture coordinator is unavailable.",
            userMessageKey: "errors.elementSelection",
            retryable: true,
            fallbackAllowed: false,
            causeCode: "SelectedTargetCaptureCoordinatorMissing",
            safeContext: { jobId: job.id },
          }),
        );
      }
      void coordinator.start(job.id).catch(() => undefined);
    }

    return createElementSelectionEventAckMessage({
      requestId: parsed.value.requestId,
      jobId: job.id,
      accepted: true,
      sentAt: dependencies.now().toISOString(),
    });
  } catch (error) {
    return createErrorResponseMessage({
      requestId: parsed.value.requestId,
      error: normalizeError(error, {
        stage: parsed.value.type === "ELEMENT_SELECTION_CANCEL" ? "cleanup" : "capture",
        userMessageKey: "errors.elementSelection",
        retryable: true,
        fallbackAllowed: false,
      }),
      sentAt: dependencies.now().toISOString(),
    });
  }
}

export async function routePdfExportProgressMessage(
  message: unknown,
  dependencies: PersistentJobRouterDependencies,
): Promise<PdfProgressRouterResponse | undefined> {
  if (!isOffscreenPdfExportProgressMessage(message)) {
    return undefined;
  }
  let accepted = false;
  if (dependencies.pdfExports !== undefined) {
    try {
      accepted = (await dependencies.pdfExports.handleProgress(message.payload)) !== undefined;
    } catch {
      try {
        accepted = (await dependencies.jobs.get(message.payload.jobId))?.state === "exporting";
      } catch {
        accepted = false;
      }
    }
  }
  return createOffscreenPdfExportProgressAckMessage({
    requestId: message.requestId,
    jobId: message.payload.jobId,
    accepted,
    sentAt: dependencies.now().toISOString(),
  });
}

export function registerPersistentJobRouter(): void {
  const dependencies = getPersistentJobRouterDependencies();
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (isOffscreenPdfExportProgressMessage(message)) {
        void routePdfExportProgressMessage(message, dependencies)
          .then((response) => {
            if (response !== undefined) {
              sendResponse(response);
            }
          })
          .catch(() => {
            sendResponse(
              createOffscreenPdfExportProgressAckMessage({
                requestId: message.requestId,
                jobId: message.payload.jobId,
                accepted: false,
                sentAt: dependencies.now().toISOString(),
              }),
            );
          });
        return true;
      }
      if (isElementSelectionEventType(message)) {
        void routeElementSelectionMessage(message, sender, dependencies).then((response) => {
          if (response !== undefined) {
            sendResponse(response);
          }
        });
        return true;
      }
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
