import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) {
    throw new Error(`Expected text not found in ${path}: ${before.slice(0, 160)}`);
  }
  await writeFile(path, source.replace(before, after), "utf8");
}

async function prependOnce(path, marker, content) {
  const source = await readFile(path, "utf8");
  if (source.includes(marker)) return;
  await writeFile(path, `${content}${source}`, "utf8");
}

await prependOnce(
  "src/content/entry.ts",
  'from "./region-selector"',
  'import { openRegionSelector, type RegionSelectorController } from "./region-selector";\n\n',
);

await replaceOnce(
  "src/content/entry.ts",
  `  pageHideListener: () => void;
}`,
  `  pageHideListener: () => void;
  region?: RegionSelectorController;
  regionListener?: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void;
  regionPageHideListener?: () => void;
}`,
);

const regionRuntime = String.raw`
interface RegionSelectionOpenRequest {
  protocolVersion: 1;
  requestId: string;
  source: "background";
  target: "content";
  type: "REGION_SELECTION_OPEN";
  payload: { jobId: string };
  sentAt: string;
}

function isRegionSelectionOpenRequest(value: unknown): value is RegionSelectionOpenRequest {
  return (
    isRecord(value) &&
    value.protocolVersion === PAGE_PREPARATION_PROTOCOL_VERSION &&
    value.source === "background" &&
    value.target === "content" &&
    value.type === "REGION_SELECTION_OPEN" &&
    hasString(value, "requestId") &&
    hasString(value, "sentAt") &&
    isRecord(value.payload) &&
    hasString(value.payload, "jobId")
  );
}

function regionSelectionResponse(
  request: RegionSelectionOpenRequest,
  type: "REGION_SELECTION_OPENED" | "REGION_SELECTION_ERROR",
  payload: unknown,
): Record<string, unknown> {
  return {
    protocolVersion: PAGE_PREPARATION_PROTOCOL_VERSION,
    requestId: request.requestId,
    source: "content",
    target: "background",
    type,
    payload,
    sentAt: new Date().toISOString(),
  };
}

function regionSelectionError(
  request: RegionSelectionOpenRequest,
  message: string,
  causeCode: string,
): Record<string, unknown> {
  return regionSelectionResponse(request, "REGION_SELECTION_ERROR", {
    code: "E_PROTOCOL_MESSAGE",
    stage: "protocol",
    message,
    userMessageKey: "errors.regionSelection",
    retryable: true,
    fallbackAllowed: false,
    causeCode,
    safeContext: { jobId: request.payload.jobId },
  });
}

async function sendRegionSelectionEvent(
  type: "REGION_SELECTION_COMMIT" | "REGION_SELECTION_CANCEL",
  jobId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await chrome.runtime.sendMessage({
    protocolVersion: PAGE_PREPARATION_PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    source: "content",
    target: "background",
    type,
    payload: { jobId, ...payload },
    sentAt: new Date().toISOString(),
  });
}

function ensureRegionSelectionRuntime(state: PagePreparationRuntimeState): void {
  if (state.regionListener !== undefined) {
    return;
  }

  state.regionListener = (message, sender, sendResponse) => {
    if (!isRegionSelectionOpenRequest(message) || sender.id !== chrome.runtime.id) {
      return false;
    }

    const current = state.region;
    if (current?.jobId === message.payload.jobId) {
      sendResponse(
        regionSelectionResponse(message, "REGION_SELECTION_OPENED", {
          jobId: message.payload.jobId,
          reused: true,
        }),
      );
      return false;
    }
    if (current !== undefined) {
      sendResponse(
        regionSelectionError(
          message,
          "This page already has an active WebCap region selector.",
          "ActiveRegionSelectionConflict",
        ),
      );
      return false;
    }

    try {
      state.region = openRegionSelector({
        jobId: message.payload.jobId,
        onCommit: async (rect) => {
          state.region = undefined;
          await sendRegionSelectionEvent("REGION_SELECTION_COMMIT", message.payload.jobId, {
            rect,
          });
        },
        onCancel: async (reason) => {
          state.region = undefined;
          await sendRegionSelectionEvent("REGION_SELECTION_CANCEL", message.payload.jobId, {
            reason,
          });
        },
      });
      sendResponse(
        regionSelectionResponse(message, "REGION_SELECTION_OPENED", {
          jobId: message.payload.jobId,
          reused: false,
        }),
      );
    } catch (error) {
      sendResponse(
        regionSelectionError(
          message,
          error instanceof Error ? error.message : "Region selector could not be created.",
          error instanceof Error ? error.name : "RegionSelectionOpenFailure",
        ),
      );
    }
    return false;
  };

  state.regionPageHideListener = () => {
    state.region?.dispose();
    state.region = undefined;
  };
  chrome.runtime.onMessage.addListener(state.regionListener);
  window.addEventListener("pagehide", state.regionPageHideListener, { once: true });
}

`;

await replaceOnce(
  "src/content/entry.ts",
  "function installRuntime(): { installed: boolean; reused: boolean; protocolVersion: number } {",
  `${regionRuntime}function installRuntime(): { installed: boolean; reused: boolean; protocolVersion: number } {`,
);

await replaceOnce(
  "src/content/entry.ts",
  `  if (existing?.version === PAGE_PREPARATION_PROTOCOL_VERSION) {
    return { installed: true, reused: true, protocolVersion: existing.version };
  }`,
  `  if (existing?.version === PAGE_PREPARATION_PROTOCOL_VERSION) {
    ensureRegionSelectionRuntime(existing);
    return { installed: true, reused: true, protocolVersion: existing.version };
  }`,
);

await replaceOnce(
  "src/content/entry.ts",
  `  chrome.runtime.onMessage.addListener(state.listener);
  window.addEventListener("pagehide", state.pageHideListener, { once: true });
  carrier[PAGE_PREPARATION_GLOBAL_KEY] = state;`,
  `  chrome.runtime.onMessage.addListener(state.listener);
  window.addEventListener("pagehide", state.pageHideListener, { once: true });
  ensureRegionSelectionRuntime(state);
  carrier[PAGE_PREPARATION_GLOBAL_KEY] = state;`,
);

await replaceOnce(
  "src/background/job-coordinator.ts",
  `  get(jobId: string): Promise<CaptureJob | undefined>;
  update(`,
  `  get(jobId: string): Promise<CaptureJob | undefined>;
  getActiveForTab(tabId: number): Promise<CaptureJob | undefined>;
  update(`,
);

await replaceOnce(
  "src/background/job-coordinator.ts",
  `  async get(jobId: string): Promise<CaptureJob | undefined> {
    await this.initialize();
    return this.jobs.get(jobId);
  }

  async update(`,
  `  async get(jobId: string): Promise<CaptureJob | undefined> {
    await this.initialize();
    return this.jobs.get(jobId);
  }

  async getActiveForTab(tabId: number): Promise<CaptureJob | undefined> {
    await this.initialize();
    const active = await this.jobs.listActive();
    return active
      .filter((job) => job.tabId === tabId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async update(`,
);

await replaceOnce(
  "src/background/full-page-capture-coordinator.ts",
  `function invalidModeError(job: CaptureJob): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "Only full-page jobs can use the full-page capture coordinator.",`,
  `function invalidModeError(job: CaptureJob): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "Only full-page and region jobs can use the tiled capture coordinator.",`,
);

await replaceOnce(
  "src/background/full-page-capture-coordinator.ts",
  `    if (job.mode !== "full-page") {
      throw invalidModeError(job);
    }
    if (job.state !== "created") {`,
  `    if (job.mode !== "full-page" && job.mode !== "region") {
      throw invalidModeError(job);
    }
    if (job.mode === "region" && job.targetRect === undefined) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_PROTOCOL_MESSAGE",
          stage: "protocol",
          message: "Region capture requires a confirmed target rectangle.",
          userMessageKey: "errors.captureTarget",
          retryable: false,
          fallbackAllowed: false,
          causeCode: "RegionTargetMissing",
          safeContext: { jobId: job.id },
        }),
      );
    }
    if (job.state !== "created") {`,
);

await replaceOnce(
  "src/background/full-page-capture-coordinator.ts",
  `        options: {
          maxCssHeight: job.settings.limits.maxCssHeight,
          lazyLoad: job.settings.lazyLoad,
        },`,
  `        options: {
          targetStartX: job.targetRect?.x ?? 0,
          targetStartY: job.targetRect?.y ?? 0,
          maxCssHeight: job.settings.limits.maxCssHeight,
          lazyLoad: job.settings.lazyLoad,
        },`,
);

await replaceOnce(
  "src/background/full-page-capture-coordinator.ts",
  `          settings: job.settings,
          preparation,
          cancellation,`,
  `          settings: job.settings,
          ...(job.targetRect === undefined ? {} : { targetRect: job.targetRect }),
          preparation,
          cancellation,`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `import { createChromeScrollCapturePageAdapter } from "@background/scroll-capture-page-adapter";`,
  `import { createChromeScrollCapturePageAdapter } from "@background/scroll-capture-page-adapter";
import {
  RegionSelectionService,
  createChromeRegionSelectionBrowserAdapter,
  type RegionSelectionPort,
} from "@background/region-selection-service";`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `  JobResponseMessageSchema,
  createJobResponseMessage,`,
  `  JobActiveResponseMessageSchema,
  JobResponseMessageSchema,
  createJobActiveResponseMessage,
  createJobResponseMessage,`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `  type JobResponseMessage,
  type PersistentJobRequest,`,
  `  type JobActiveResponseMessage,
  type JobResponseMessage,
  type PersistentJobRequest,`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `} from "@shared/contracts/job-messages";
import {`,
  `} from "@shared/contracts/job-messages";
import {
  createRegionSelectionEventAckMessage,
  isRegionSelectionEventType,
  parseRegionSelectionEvent,
  type RegionSelectionEventAckMessage,
} from "@shared/contracts/region-selection";
import {`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `export type PersistentJobRouterResponse = JobResponseMessage | ErrorResponseMessage;`,
  `export type PersistentJobRouterResponse =
  | JobResponseMessage
  | JobActiveResponseMessage
  | ErrorResponseMessage;

export type RegionSelectionRouterResponse = RegionSelectionEventAckMessage | ErrorResponseMessage;`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `  captures?: FullPageCapturePort;
}`,
  `  captures?: FullPageCapturePort;
  regions?: RegionSelectionPort;
}`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `      async cleanup(job) {
        if (job.mode !== "full-page") {
          return;
        }`,
  `      async cleanup(job) {
        if (job.mode !== "full-page" && job.mode !== "region") {
          return;
        }`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `  const captures = new FullPageCaptureCoordinator({
    jobs,
    pages,
    tiles,
    engine: new CdpCaptureEngine(new DebuggerClient(createChromeDebuggerAdapter())),
    fallbackEngine: new ScrollCaptureEngine({ pages: scrollPages, tabs }),
  });
  const dedupe = new IndexedDbDedupeRepository();
  sharedDependencies = { jobs, captures, dedupe, now: () => new Date() };`,
  `  const captures = new FullPageCaptureCoordinator({
    jobs,
    pages,
    tiles,
    engine: new CdpCaptureEngine(new DebuggerClient(createChromeDebuggerAdapter())),
    fallbackEngine: new ScrollCaptureEngine({ pages: scrollPages, tabs }),
  });
  const regions = new RegionSelectionService(createChromeRegionSelectionBrowserAdapter());
  const dedupe = new IndexedDbDedupeRepository();
  sharedDependencies = { jobs, captures, regions, dedupe, now: () => new Date() };`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `  return type === "JOB_CREATE" || type === "JOB_GET" || type === "JOB_CANCEL";`,
  `  return (
    type === "JOB_CREATE" ||
    type === "JOB_GET" ||
    type === "JOB_GET_ACTIVE" ||
    type === "JOB_CANCEL"
  );`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `  const jobResponse = JobResponseMessageSchema.safeParse(record.response);
  if (jobResponse.success) {
    return jobResponse.data;
  }
  const errorResponse`,
  `  const jobResponse = JobResponseMessageSchema.safeParse(record.response);
  if (jobResponse.success) {
    return jobResponse.data;
  }
  const activeResponse = JobActiveResponseMessageSchema.safeParse(record.response);
  if (activeResponse.success) {
    return activeResponse.data;
  }
  const errorResponse`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `async function executeJobRequest(
  request: PersistentJobRequest,
  dependencies: PersistentJobRouterDependencies,
): Promise<CaptureJob> {`,
  `type JobRequestResult =
  | { kind: "job"; job: CaptureJob }
  | { kind: "active"; job: CaptureJob | null };

async function executeJobRequest(
  request: PersistentJobRequest,
  dependencies: PersistentJobRouterDependencies,
): Promise<JobRequestResult> {`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `      if (job.mode === "full-page" && dependencies.captures !== undefined) {
        void dependencies.captures.start(job.id).catch(() => undefined);
      }
      return job;`,
  `      if (job.mode === "full-page" && dependencies.captures !== undefined) {
        void dependencies.captures.start(job.id).catch(() => undefined);
      } else if (job.mode === "region" && dependencies.regions !== undefined) {
        try {
          await dependencies.regions.start(job.tabId, job.id);
        } catch (error) {
          await dependencies.jobs.cancel(job.id, "region selector failed to open");
          throw error;
        }
      }
      return { kind: "job", job };`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `      return job;
    }
    case "JOB_CANCEL": {`,
  `      return { kind: "job", job };
    }
    case "JOB_GET_ACTIVE": {
      return {
        kind: "active",
        job: (await dependencies.jobs.getActiveForTab(request.payload.tabId)) ?? null,
      };
    }
    case "JOB_CANCEL": {`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `      if (job.mode === "full-page" && dependencies.captures !== undefined) {
        return dependencies.captures.cancel(job.id, request.payload.reason);
      }
      return dependencies.jobs.cancel(job.id, request.payload.reason);`,
  `      if (
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
      };`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `    const job = await executeJobRequest(parsed.value, dependencies);
    const response = createJobResponseMessage({
      requestId: parsed.value.requestId,
      job,
      sentAt: dependencies.now().toISOString(),
    });
    await cacheResponse(parsed.value.type, parsed.value.requestId, job.id, response, dependencies);`,
  `    const result = await executeJobRequest(parsed.value, dependencies);
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
    );`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `    const jobId = parsed.value.type === "JOB_CREATE" ? undefined : parsed.value.payload.jobId;
    await cacheResponse(parsed.value.type, parsed.value.requestId, jobId, response, dependencies);`,
  `    const jobId =
      parsed.value.type === "JOB_GET" || parsed.value.type === "JOB_CANCEL"
        ? parsed.value.payload.jobId
        : undefined;
    await cacheResponse(parsed.value.type, parsed.value.requestId, jobId, response, dependencies);`,
);

const regionRouter = String.raw`

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
      await dependencies.jobs.cancel(job.id, parsed.value.payload.reason ?? "region selection cancelled");
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
`;

await replaceOnce(
  "src/background/persistent-job-router.ts",
  "export function registerPersistentJobRouter(): void {",
  `${regionRouter}\nexport function registerPersistentJobRouter(): void {`,
);

await replaceOnce(
  "src/background/persistent-job-router.ts",
  `  chrome.runtime.onMessage.addListener(
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
}`,
  `  chrome.runtime.onMessage.addListener(
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
}`,
);

await replaceOnce(
  "src/background/message-router.ts",
  `import type { WebCapErrorData } from "@shared/errors/error";`,
  `import { isRegionSelectionEventType } from "@shared/contracts/region-selection";
import type { WebCapErrorData } from "@shared/errors/error";`,
);

await replaceOnce(
  "src/background/message-router.ts",
  `  return type === "JOB_CREATE" || type === "JOB_GET" || type === "JOB_CANCEL";`,
  `  return (
    type === "JOB_CREATE" ||
    type === "JOB_GET" ||
    type === "JOB_GET_ACTIVE" ||
    type === "JOB_CANCEL"
  );`,
);

await replaceOnce(
  "src/background/message-router.ts",
  `    (value as { target?: unknown }).target === "background" &&
    !isPersistentJobMessageType(value)`,
  `    (value as { target?: unknown }).target === "background" &&
    !isPersistentJobMessageType(value) &&
    !isRegionSelectionEventType(value)`,
);

const client = String.raw`import { DEFAULT_REQUEST_TIMEOUT_MS } from "@shared/constants";
import type { CaptureJob, ImageFormat } from "@shared/contracts/domain";
import {
  createJobCancelMessage,
  createJobCreateMessage,
  createJobGetActiveMessage,
  createJobGetMessage,
  isJobActiveResponseMessage,
  isJobResponseMessage,
} from "@shared/contracts/job-messages";
import { isErrorResponseMessage } from "@shared/contracts/messages";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

function rejectAfter(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => reject(new Error("Capture job request timed out.")), timeoutMs);
  });
}

async function sendJobRequest(
  request: unknown,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<CaptureJob> {
  const response: unknown = await Promise.race([
    chrome.runtime.sendMessage(request),
    rejectAfter(timeoutMs),
  ]);
  if (isErrorResponseMessage(response)) {
    const error = new Error(response.payload.message);
    error.name = response.payload.code;
    throw error;
  }
  if (!isJobResponseMessage(response)) {
    throw new TypeError("Service worker returned an invalid capture job response.");
  }
  if (
    typeof request !== "object" ||
    request === null ||
    !("requestId" in request) ||
    response.requestId !== request.requestId
  ) {
    throw new Error("Service worker response did not match the capture job request.");
  }
  return response.payload.job;
}

function startTiledCapture(options: {
  tabId: number;
  windowId: number;
  outputFormat: ImageFormat;
  mode: "full-page" | "region";
}): Promise<CaptureJob> {
  return sendJobRequest(
    createJobCreateMessage({
      requestId: crypto.randomUUID(),
      sentAt: new Date().toISOString(),
      tabId: options.tabId,
      windowId: options.windowId,
      mode: options.mode,
      preferredEngine: "cdp",
      settings: {
        ...DEFAULT_CAPTURE_SETTINGS,
        outputFormat: options.outputFormat,
      },
    }),
  );
}

export function startFullPageCapture(options: {
  tabId: number;
  windowId: number;
  outputFormat: ImageFormat;
}): Promise<CaptureJob> {
  return startTiledCapture({ ...options, mode: "full-page" });
}

export function startRegionCapture(options: {
  tabId: number;
  windowId: number;
  outputFormat: ImageFormat;
}): Promise<CaptureJob> {
  return startTiledCapture({ ...options, mode: "region" });
}

export function getCaptureJob(jobId: string): Promise<CaptureJob> {
  return sendJobRequest(
    createJobGetMessage({
      requestId: crypto.randomUUID(),
      jobId,
      sentAt: new Date().toISOString(),
    }),
  );
}

export async function getActiveCaptureJob(tabId: number): Promise<CaptureJob | undefined> {
  const request = createJobGetActiveMessage({
    requestId: crypto.randomUUID(),
    tabId,
    sentAt: new Date().toISOString(),
  });
  const response: unknown = await Promise.race([
    chrome.runtime.sendMessage(request),
    rejectAfter(DEFAULT_REQUEST_TIMEOUT_MS),
  ]);
  if (isErrorResponseMessage(response)) {
    const error = new Error(response.payload.message);
    error.name = response.payload.code;
    throw error;
  }
  if (!isJobActiveResponseMessage(response) || response.requestId !== request.requestId) {
    throw new TypeError("Service worker returned an invalid active capture response.");
  }
  return response.payload.job ?? undefined;
}

export function cancelFullPageCapture(jobId: string): Promise<CaptureJob> {
  return sendJobRequest(
    createJobCancelMessage({
      requestId: crypto.randomUUID(),
      jobId,
      reason: "popup cancellation",
      sentAt: new Date().toISOString(),
    }),
  );
}
`;
await writeFile("src/popup/full-page-client.ts", client, "utf8");

await replaceOnce(
  "src/popup/App.tsx",
  `import { cancelFullPageCapture, getCaptureJob, startFullPageCapture } from "./full-page-client";`,
  `import {
  cancelFullPageCapture,
  getActiveCaptureJob,
  getCaptureJob,
  startFullPageCapture,
  startRegionCapture,
} from "./full-page-client";`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `const FULL_PAGE_STATUS_COPY: Record<CaptureJob["state"], string> = {`,
  `const TILED_STATUS_COPY: Record<CaptureJob["state"], string> = {`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `function isFullPageBusy(job: CaptureJob | undefined): boolean {`,
  `function tiledStatusCopy(job: CaptureJob): string {
  if (job.mode === "region") {
    if (job.state === "created") return "Chọn vùng trực tiếp trên trang…";
    if (job.state === "ready") return "Tile set vùng chọn đã sẵn sàng.";
    if (job.state === "failed") return "Không thể hoàn tất chụp vùng chọn.";
    if (job.state === "cancelled") return "Đã hủy chọn vùng.";
  }
  return TILED_STATUS_COPY[job.state];
}

function isFullPageBusy(job: CaptureJob | undefined): boolean {`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `        try {
          const currentSession = await getVisibleSession();
          if (active) {
            setSession(currentSession);
            if (currentSession !== undefined) {
              setSelectedFormat(currentSession.format);
            }
          }
        } catch (error) {`,
  `        try {
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
              (activeJob.mode === "full-page" || activeJob.mode === "region")
            ) {
              setFullPageJob(activeJob);
              setSelectedMode(activeJob.mode);
            }
          }
        } catch (error) {`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `  const busy = selectedMode === "full-page" ? fullPageBusy : visibleBusy;
  const terminal =
    selectedMode === "full-page"`,
  `  const tiledMode = selectedMode === "full-page" || selectedMode === "region";
  const busy = tiledMode ? fullPageBusy : visibleBusy;
  const terminal =
    tiledMode`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `  const handleCapture = useCallback(async (): Promise<void> => {
    if (!canCapture) {
      return;
    }
    if (selectedMode === "full-page") {
      await handleFullPageCapture();
      return;
    }
    await handleVisibleCapture();
  }, [canCapture, handleFullPageCapture, handleVisibleCapture, selectedMode]);`,
  `  const handleRegionCapture = useCallback(async (): Promise<void> => {
    if (tabCapability.tabId === undefined || tabCapability.windowId === undefined) {
      setUiError("Không xác định được tab đang hoạt động.");
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
    } catch (error) {
      setUiError(errorMessage(error));
    }
  }, [selectedFormat, tabCapability.tabId, tabCapability.windowId]);

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
    await handleVisibleCapture();
  }, [
    canCapture,
    handleFullPageCapture,
    handleRegionCapture,
    handleVisibleCapture,
    selectedMode,
  ]);`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `    if (selectedMode === "full-page") {`,
  `    if (selectedMode === "full-page" || selectedMode === "region") {`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `    if (selectedMode === "full-page") {
      if (fullPageJob !== undefined && fullPageJob.state !== "cancelled") {`,
  `    if (selectedMode === "full-page" || selectedMode === "region") {
      if (fullPageJob !== undefined && fullPageJob.state !== "cancelled") {`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `      await handleFullPageCapture();
      return;`,
  `      if (selectedMode === "region") {
        await handleRegionCapture();
      } else {
        await handleFullPageCapture();
      }
      return;`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `    handleFullPageCapture,
    handleVisibleCapture,`,
  `    handleFullPageCapture,
    handleRegionCapture,
    handleVisibleCapture,`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `{selectedMode === "full-page" ? "Chụp toàn bộ trang" : "Chụp vùng đang xem"}`,
  `{selectedMode === "full-page"
                ? "Chụp toàn bộ trang"
                : selectedMode === "region"
                  ? "Chụp vùng tự chọn"
                  : "Chụp vùng đang xem"}`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `<span className="planned-badge">S09</span>`,
  `<span className="planned-badge">{selectedMode === "region" ? "S11" : "S10"}</span>`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `{selectedMode === "full-page" ? "Bắt đầu chụp toàn trang" : "Tạo bản xem trước"}`,
  `{selectedMode === "full-page"
              ? "Bắt đầu chụp toàn trang"
              : selectedMode === "region"
                ? "Bắt đầu chọn vùng"
                : "Tạo bản xem trước"}`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `{selectedMode === "full-page" && fullPageJob !== undefined && (`,
  `{tiledMode && fullPageJob !== undefined && (`,
);

await replaceOnce(
  "src/popup/App.tsx",
  `{FULL_PAGE_STATUS_COPY[fullPageJob.state]}`,
  `{tiledStatusCopy(fullPageJob)}`,
);
