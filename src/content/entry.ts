import { openRegionSelector, type RegionSelectorController } from "./region-selector";

export const PAGE_PREPARATION_PROTOCOL_VERSION = 1 as const;
export const PAGE_PREPARATION_SNAPSHOT_VERSION = 1 as const;
export const PAGE_PREPARATION_GLOBAL_KEY = "__webcapPagePreparationV1__" as const;
export const PAGE_PREPARATION_STYLE_ATTRIBUTE = "data-webcap-preparation" as const;

export interface LayoutSample {
  width: number;
  height: number;
  mutationRevision: number;
  pendingImages: number;
}

export interface PagePreparationCleanupReport {
  preparationId: string;
  attempted: boolean;
  completed: boolean;
  restoredProperties: number;
  skippedChangedProperties: number;
  missingNodes: number;
  residualMutations: number;
  styleRemoved: boolean;
  scrollRestored: boolean;
  focusRestored: boolean;
  errors: number;
}

export function layoutSamplesMatch(
  previous: LayoutSample | undefined,
  current: LayoutSample,
  epsilon = 0.5,
): boolean {
  return (
    previous !== undefined &&
    Math.abs(previous.width - current.width) <= epsilon &&
    Math.abs(previous.height - current.height) <= epsilon &&
    previous.mutationRevision === current.mutationRevision &&
    previous.pendingImages === current.pendingImages
  );
}

export function updateStableSampleCount(
  previous: LayoutSample | undefined,
  current: LayoutSample,
  currentStableCount: number,
): number {
  return layoutSamplesMatch(previous, current) ? currentStableCount + 1 : 0;
}

export function shouldRestoreCssProperty(
  currentValue: string,
  currentPriority: string,
  appliedValue: string,
  appliedPriority: string,
): boolean {
  return currentValue === appliedValue && currentPriority === appliedPriority;
}

export function nextLazyScrollPosition(
  currentY: number,
  viewportHeight: number,
  stepRatio: number,
  maxY: number,
): number {
  const safeCurrent = Number.isFinite(currentY) ? Math.max(0, currentY) : 0;
  const safeViewport = Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight) : 1;
  const safeRatio = Number.isFinite(stepRatio) ? Math.min(1, Math.max(0.1, stepRatio)) : 0.8;
  const safeMax = Number.isFinite(maxY) ? Math.max(0, maxY) : 0;
  return Math.min(safeMax, safeCurrent + Math.max(1, safeViewport * safeRatio));
}

interface PagePreparationOptions {
  targetStartX: number;
  targetStartY: number;
  maxCssHeight: number;
  lazyLoad: {
    enabled: boolean;
    stepRatio: number;
    settleMs: number;
    maxDurationMs: number;
  };
}

interface PagePrepareRequest {
  protocolVersion: 1;
  requestId: string;
  source: "background";
  target: "content";
  type: "PAGE_PREPARATION_PREPARE";
  payload: {
    preparationId: string;
    options: PagePreparationOptions;
  };
  sentAt: string;
}

interface PageRestoreRequest {
  protocolVersion: 1;
  requestId: string;
  source: "background";
  target: "content";
  type: "PAGE_PREPARATION_RESTORE";
  payload: { preparationId: string };
  sentAt: string;
}

interface PageCancelRequest {
  protocolVersion: 1;
  requestId: string;
  source: "background";
  target: "content";
  type: "PAGE_PREPARATION_CANCEL";
  payload: { preparationId: string };
  sentAt: string;
}

type PagePreparationRequest = PagePrepareRequest | PageRestoreRequest | PageCancelRequest;

interface CssPropertyMutation {
  element: HTMLElement;
  property: string;
  beforeValue: string;
  beforePriority: string;
  appliedValue: string;
  appliedPriority: string;
  beforeStyleAttribute: string | null;
  appliedStyleAttribute: string | null;
}

interface PreparationSnapshot {
  version: 1;
  preparationId: string;
  originalScrollX: number;
  originalScrollY: number;
  preparedScrollX: number;
  preparedScrollY: number;
  activeElement: HTMLElement | null;
  selectionRanges: Range[];
  styleElement: HTMLStyleElement;
  styleText: string;
  mutations: CssPropertyMutation[];
}

interface ActivePreparation {
  preparationId: string;
  requestId: string;
  status: "preparing" | "ready" | "restoring";
  cancelled: boolean;
  snapshot: PreparationSnapshot;
  readyResponse?: unknown;
}

interface PagePreparationRuntimeState {
  version: 1;
  active?: ActivePreparation;
  completedReports: Map<string, PagePreparationCleanupReport>;
  listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void;
  pageHideListener: () => void;
  region?: RegionSelectorController;
  regionListener?: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void;
  regionPageHideListener?: () => void;
}

interface StateCarrier {
  [PAGE_PREPARATION_GLOBAL_KEY]?: PagePreparationRuntimeState;
}

interface ErrorLike {
  code: string;
  stage: "prepare" | "cleanup" | "protocol";
  message: string;
  userMessageKey: string;
  retryable: boolean;
  fallbackAllowed: boolean;
  causeCode?: string;
  safeContext?: Record<string, string | number | boolean>;
}

class PreparationFailure extends Error {
  readonly data: ErrorLike;

  constructor(data: ErrorLike) {
    super(data.message);
    this.name = data.code;
    this.data = data;
  }
}

function preparationFailure(options: ErrorLike): PreparationFailure {
  return new PreparationFailure(options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0;
}

export function isPagePreparationRequest(value: unknown): value is PagePreparationRequest {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.protocolVersion !== PAGE_PREPARATION_PROTOCOL_VERSION ||
    value.source !== "background" ||
    value.target !== "content" ||
    !hasString(value, "requestId") ||
    !hasString(value, "sentAt") ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  if (value.type === "PAGE_PREPARATION_PREPARE") {
    const payload = value.payload;
    if (!hasString(payload, "preparationId") || !isRecord(payload.options)) {
      return false;
    }
    const options = payload.options;
    return (
      typeof options.targetStartX === "number" &&
      Number.isFinite(options.targetStartX) &&
      typeof options.targetStartY === "number" &&
      Number.isFinite(options.targetStartY) &&
      typeof options.maxCssHeight === "number" &&
      Number.isFinite(options.maxCssHeight) &&
      options.maxCssHeight > 0 &&
      isRecord(options.lazyLoad) &&
      typeof options.lazyLoad.enabled === "boolean" &&
      typeof options.lazyLoad.stepRatio === "number" &&
      Number.isFinite(options.lazyLoad.stepRatio) &&
      typeof options.lazyLoad.settleMs === "number" &&
      Number.isFinite(options.lazyLoad.settleMs) &&
      typeof options.lazyLoad.maxDurationMs === "number" &&
      Number.isFinite(options.lazyLoad.maxDurationMs)
    );
  }

  return (
    (value.type === "PAGE_PREPARATION_RESTORE" || value.type === "PAGE_PREPARATION_CANCEL") &&
    hasString(value.payload, "preparationId")
  );
}

function responseEnvelope(
  request: PagePreparationRequest,
  type: string,
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

function errorResponse(request: PagePreparationRequest, error: unknown): Record<string, unknown> {
  const normalized =
    error instanceof PreparationFailure
      ? error.data
      : ({
          code: "E_UNKNOWN",
          stage: request.type === "PAGE_PREPARATION_RESTORE" ? "cleanup" : "prepare",
          message:
            error instanceof Error && error.message.trim().length > 0
              ? error.message.slice(0, 500)
              : "The page preparation operation failed.",
          userMessageKey: "errors.pagePreparation",
          retryable: true,
          fallbackAllowed: false,
          causeCode: error instanceof Error ? error.name : "UnknownError",
        } satisfies ErrorLike);
  return responseEnvelope(request, "PAGE_PREPARATION_ERROR", normalized);
}

function readDocumentSize(): { width: number; height: number } {
  const root = document.documentElement;
  const body = document.body;
  return {
    width: Math.max(
      root?.scrollWidth ?? 0,
      root?.clientWidth ?? 0,
      body?.scrollWidth ?? 0,
      body?.clientWidth ?? 0,
    ),
    height: Math.max(
      root?.scrollHeight ?? 0,
      root?.clientHeight ?? 0,
      body?.scrollHeight ?? 0,
      body?.clientHeight ?? 0,
    ),
  };
}

function readLayoutSample(mutationRevision: number): LayoutSample {
  const size = readDocumentSize();
  let pendingImages = 0;
  for (const image of Array.from(document.images)) {
    if (!image.complete) {
      pendingImages += 1;
    }
  }
  return { ...size, mutationRevision, pendingImages };
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function waitForFrames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await waitForFrame();
  }
}

function waitForDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, Math.max(0, milliseconds));
  });
}

function throwIfCancelled(active: ActivePreparation): void {
  if (active.cancelled) {
    throw preparationFailure({
      code: "E_CANCELLED",
      stage: "prepare",
      message: "Page preparation was cancelled.",
      userMessageKey: "errors.cancelled",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "UserCancellation",
      safeContext: { preparationId: active.preparationId },
    });
  }
}

async function decodeVisibleImages(timeoutMs: number): Promise<void> {
  const candidates = Array.from(document.images).filter((image) => {
    if (image.complete || typeof image.decode !== "function") {
      return false;
    }
    const rect = image.getBoundingClientRect();
    return (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth
    );
  });
  if (candidates.length === 0) {
    return;
  }

  await Promise.race([
    Promise.allSettled(candidates.map((image) => image.decode())).then(() => undefined),
    waitForDelay(Math.max(1, timeoutMs)),
  ]);
}

async function waitForLayoutSettle(
  active: ActivePreparation,
  settleMs: number,
  timeoutMs: number,
  stableSampleTarget: number,
): Promise<{ stableSamples: number; mutationCount: number; sample: LayoutSample }> {
  const root = document.documentElement;
  if (root === null) {
    throw preparationFailure({
      code: "E_LAYOUT_UNSTABLE",
      stage: "prepare",
      message: "The page document element is unavailable.",
      userMessageKey: "errors.layoutUnstable",
      retryable: true,
      fallbackAllowed: true,
      causeCode: "MissingDocumentElement",
    });
  }

  let mutationRevision = 0;
  const mutationObserver = new MutationObserver(() => {
    mutationRevision += 1;
  });
  mutationObserver.observe(root, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });

  let resizeRevision = 0;
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(() => {
          resizeRevision += 1;
        });
  resizeObserver?.observe(root);
  if (document.body !== null) {
    resizeObserver?.observe(document.body);
  }

  const deadline = Date.now() + Math.max(100, timeoutMs);
  let previous: LayoutSample | undefined;
  let stableSamples = 0;
  let lastSample = readLayoutSample(0);

  try {
    while (Date.now() < deadline) {
      throwIfCancelled(active);
      await waitForFrames(2);
      await decodeVisibleImages(Math.min(250, Math.max(1, settleMs)));
      throwIfCancelled(active);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      await waitForDelay(Math.min(Math.max(0, settleMs), remaining));
      throwIfCancelled(active);

      lastSample = readLayoutSample(mutationRevision + resizeRevision);
      stableSamples = updateStableSampleCount(previous, lastSample, stableSamples);
      if (stableSamples >= stableSampleTarget) {
        return {
          stableSamples,
          mutationCount: mutationRevision + resizeRevision,
          sample: lastSample,
        };
      }
      previous = lastSample;
    }
  } finally {
    mutationObserver.disconnect();
    resizeObserver?.disconnect();
  }

  throw preparationFailure({
    code: "E_LAYOUT_UNSTABLE",
    stage: "prepare",
    message: "The page layout did not settle before the preparation deadline.",
    userMessageKey: "errors.layoutUnstable",
    retryable: true,
    fallbackAllowed: true,
    causeCode: "LayoutSettleTimeout",
    safeContext: {
      preparationId: active.preparationId,
      documentWidth: Math.round(lastSample.width),
      documentHeight: Math.round(lastSample.height),
      pendingImages: lastSample.pendingImages,
    },
  });
}

function createFreezeStyle(preparationId: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.id = `webcap-preparation-${preparationId.replace(/[^a-zA-Z0-9_-]/gu, "-")}`;
  style.setAttribute(PAGE_PREPARATION_STYLE_ATTRIBUTE, preparationId);
  style.textContent = [
    "*, *::before, *::after {",
    "  animation-play-state: paused !important;",
    "  caret-color: transparent !important;",
    "}",
    "html {",
    "  scroll-behavior: auto !important;",
    "}",
  ].join("\n");
  (document.head ?? document.documentElement).append(style);
  return style;
}

function captureSelection(): Range[] {
  const selection = window.getSelection();
  if (selection === null) {
    return [];
  }
  const ranges: Range[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    ranges.push(selection.getRangeAt(index).cloneRange());
  }
  return ranges;
}

function applyCssProperty(
  element: HTMLElement,
  property: string,
  value: string,
  priority: string,
): CssPropertyMutation {
  const beforeValue = element.style.getPropertyValue(property);
  const beforePriority = element.style.getPropertyPriority(property);
  const beforeStyleAttribute = element.getAttribute("style");
  element.style.setProperty(property, value, priority);
  return {
    element,
    property,
    beforeValue,
    beforePriority,
    appliedValue: element.style.getPropertyValue(property),
    appliedPriority: element.style.getPropertyPriority(property),
    beforeStyleAttribute,
    appliedStyleAttribute: element.getAttribute("style"),
  };
}

function hideWebCapOverlays(): CssPropertyMutation[] {
  const mutations: CssPropertyMutation[] = [];
  const candidates = document.querySelectorAll<HTMLElement>(
    "[data-webcap-overlay-root], [data-webcap-overlay]",
  );
  for (const element of candidates) {
    mutations.push(applyCssProperty(element, "visibility", "hidden", "important"));
  }
  return mutations;
}

function createSnapshot(preparationId: string): PreparationSnapshot {
  const styleElement = createFreezeStyle(preparationId);
  return {
    version: PAGE_PREPARATION_SNAPSHOT_VERSION,
    preparationId,
    originalScrollX: window.scrollX,
    originalScrollY: window.scrollY,
    preparedScrollX: window.scrollX,
    preparedScrollY: window.scrollY,
    activeElement: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    selectionRanges: captureSelection(),
    styleElement,
    styleText: styleElement.textContent ?? "",
    mutations: hideWebCapOverlays(),
  };
}

function restoreSelection(ranges: Range[]): boolean {
  if (ranges.length === 0) {
    return false;
  }
  const selection = window.getSelection();
  if (selection === null) {
    return false;
  }
  selection.removeAllRanges();
  for (const range of ranges) {
    selection.addRange(range);
  }
  return true;
}

function rememberCompletedReport(
  state: PagePreparationRuntimeState,
  report: PagePreparationCleanupReport,
): void {
  state.completedReports.set(report.preparationId, report);
  while (state.completedReports.size > 8) {
    const oldest = state.completedReports.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    state.completedReports.delete(oldest);
  }
}

async function restoreSnapshot(
  state: PagePreparationRuntimeState,
  active: ActivePreparation,
  waitForPaint: boolean,
): Promise<PagePreparationCleanupReport> {
  active.status = "restoring";
  const snapshot = active.snapshot;
  const report: PagePreparationCleanupReport = {
    preparationId: snapshot.preparationId,
    attempted: true,
    completed: true,
    restoredProperties: 0,
    skippedChangedProperties: 0,
    missingNodes: 0,
    residualMutations: 0,
    styleRemoved: false,
    scrollRestored: false,
    focusRestored: false,
    errors: 0,
  };

  for (const mutation of snapshot.mutations) {
    try {
      if (!mutation.element.isConnected) {
        report.missingNodes += 1;
        continue;
      }
      const currentStyleAttribute = mutation.element.getAttribute("style");
      if (currentStyleAttribute === mutation.appliedStyleAttribute) {
        if (mutation.beforeStyleAttribute === null) {
          mutation.element.removeAttribute("style");
        } else {
          mutation.element.setAttribute("style", mutation.beforeStyleAttribute);
        }
        report.restoredProperties += 1;
      } else {
        report.skippedChangedProperties += 1;
      }
    } catch {
      report.errors += 1;
      report.residualMutations += 1;
    }
  }

  try {
    const scrollStillOwned =
      Math.abs(window.scrollX - snapshot.preparedScrollX) <= 1 &&
      Math.abs(window.scrollY - snapshot.preparedScrollY) <= 1;
    if (scrollStillOwned) {
      window.scrollTo({
        left: snapshot.originalScrollX,
        top: snapshot.originalScrollY,
        behavior: "auto",
      });
      report.scrollRestored = true;
    }
  } catch {
    report.errors += 1;
  }

  try {
    if (snapshot.styleElement.isConnected) {
      const stillOwned =
        snapshot.styleElement.getAttribute(PAGE_PREPARATION_STYLE_ATTRIBUTE) ===
          snapshot.preparationId && snapshot.styleElement.textContent === snapshot.styleText;
      if (stillOwned) {
        snapshot.styleElement.remove();
        report.styleRemoved = true;
      } else {
        report.residualMutations += 1;
      }
    } else {
      report.styleRemoved = true;
    }
  } catch {
    report.errors += 1;
    report.residualMutations += 1;
  }

  try {
    const focusCandidate = snapshot.activeElement;
    if (
      focusCandidate !== null &&
      focusCandidate.isConnected &&
      (document.activeElement === focusCandidate ||
        document.activeElement === document.body ||
        document.activeElement === document.documentElement)
    ) {
      focusCandidate.focus({ preventScroll: true });
      report.focusRestored = document.activeElement === focusCandidate;
    }
    restoreSelection(snapshot.selectionRanges);
  } catch {
    report.errors += 1;
  }

  if (waitForPaint) {
    try {
      await waitForFrames(2);
    } catch {
      report.errors += 1;
    }
  }

  report.completed = report.errors === 0 && report.residualMutations === 0;
  delete state.active;
  rememberCompletedReport(state, report);
  return report;
}

function scrollPreparedPage(active: ActivePreparation, left: number, top: number): void {
  window.scrollTo({ left, top, behavior: "auto" });
  active.snapshot.preparedScrollX = window.scrollX;
  active.snapshot.preparedScrollY = window.scrollY;
}

async function runLazyPreScroll(
  active: ActivePreparation,
  options: PagePreparationOptions,
): Promise<{
  reachedLimit: boolean;
  stableSamples: number;
  mutationCount: number;
  documentWidth: number;
  documentHeight: number;
}> {
  const settleMs = Math.max(0, Math.round(options.lazyLoad.settleMs));
  const maxDurationMs = Math.max(100, Math.round(options.lazyLoad.maxDurationMs));
  const targetStartX = Math.max(0, options.targetStartX);
  const targetStartY = Math.max(0, options.targetStartY);

  scrollPreparedPage(active, targetStartX, targetStartY);
  const initialSettle = await waitForLayoutSettle(
    active,
    settleMs,
    Math.max(1_000, settleMs * 8),
    2,
  );

  let stableSamples = initialSettle.stableSamples;
  let mutationCount = initialSettle.mutationCount;
  let lastHeight = initialSettle.sample.height;
  let stableHeightCount = 0;
  let reachedLimit = false;
  const deadline = Date.now() + maxDurationMs;

  if (options.lazyLoad.enabled) {
    while (Date.now() < deadline) {
      throwIfCancelled(active);
      const size = readDocumentSize();
      if (size.height >= options.maxCssHeight) {
        reachedLimit = true;
      }
      const cappedHeight = Math.min(size.height, options.maxCssHeight);
      const maxScrollY = Math.max(0, cappedHeight - Math.max(1, window.innerHeight));
      const currentY = window.scrollY;
      const nextY = nextLazyScrollPosition(
        currentY,
        window.innerHeight,
        options.lazyLoad.stepRatio,
        maxScrollY,
      );

      if (Math.abs(nextY - currentY) > 0.5) {
        scrollPreparedPage(active, targetStartX, nextY);
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        reachedLimit = true;
        break;
      }
      const settle = await waitForLayoutSettle(
        active,
        settleMs,
        Math.min(Math.max(500, settleMs * 6), remaining),
        1,
      );
      stableSamples += settle.stableSamples;
      mutationCount += settle.mutationCount;
      const newHeight = settle.sample.height;
      stableHeightCount = Math.abs(newHeight - lastHeight) <= 0.5 ? stableHeightCount + 1 : 0;
      lastHeight = newHeight;

      const atBottom =
        window.scrollY >=
        Math.max(0, Math.min(newHeight, options.maxCssHeight) - window.innerHeight - 1);
      if (atBottom && stableHeightCount >= 3) {
        break;
      }
      if (reachedLimit && atBottom) {
        break;
      }
    }

    if (Date.now() >= deadline) {
      reachedLimit = true;
    }
  }

  throwIfCancelled(active);
  scrollPreparedPage(active, targetStartX, targetStartY);
  const finalSettle = await waitForLayoutSettle(active, settleMs, Math.max(1_000, settleMs * 8), 2);
  stableSamples += finalSettle.stableSamples;
  mutationCount += finalSettle.mutationCount;

  return {
    reachedLimit,
    stableSamples,
    mutationCount,
    documentWidth: finalSettle.sample.width,
    documentHeight: finalSettle.sample.height,
  };
}

async function handlePrepare(
  state: PagePreparationRuntimeState,
  request: PagePrepareRequest,
): Promise<Record<string, unknown>> {
  const preparationId = request.payload.preparationId;
  const current = state.active;
  if (current !== undefined) {
    if (current.preparationId === preparationId && current.readyResponse !== undefined) {
      return current.readyResponse as Record<string, unknown>;
    }
    throw preparationFailure({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "This page already has an active WebCap preparation.",
      userMessageKey: "errors.pagePreparationActive",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "ActivePreparationConflict",
      safeContext: { preparationId },
    });
  }

  const snapshot = createSnapshot(preparationId);
  const active: ActivePreparation = {
    preparationId,
    requestId: request.requestId,
    status: "preparing",
    cancelled: false,
    snapshot,
  };
  state.active = active;

  try {
    const settle = await runLazyPreScroll(active, request.payload.options);
    throwIfCancelled(active);
    active.status = "ready";
    const response = responseEnvelope(request, "PAGE_PREPARATION_READY", {
      preparationId,
      snapshotVersion: snapshot.version,
      originalScroll: { x: snapshot.originalScrollX, y: snapshot.originalScrollY },
      preparedScroll: { x: snapshot.preparedScrollX, y: snapshot.preparedScrollY },
      documentWidth: settle.documentWidth,
      documentHeight: settle.documentHeight,
      reachedLimit: settle.reachedLimit,
      stableSamples: settle.stableSamples,
      mutationCount: settle.mutationCount,
      modifiedNodeCount: snapshot.mutations.length,
    });
    active.readyResponse = response;
    return response;
  } catch (error) {
    const report = await restoreSnapshot(state, active, true);
    if (error instanceof PreparationFailure) {
      error.data.safeContext = {
        ...(error.data.safeContext ?? {}),
        cleanupCompleted: report.completed,
      };
    }
    throw error;
  }
}

async function handleRestore(
  state: PagePreparationRuntimeState,
  request: PageRestoreRequest,
): Promise<Record<string, unknown>> {
  const completed = state.completedReports.get(request.payload.preparationId);
  if (completed !== undefined) {
    return responseEnvelope(request, "PAGE_PREPARATION_RESTORED", completed);
  }

  const active = state.active;
  if (active === undefined || active.preparationId !== request.payload.preparationId) {
    throw preparationFailure({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The requested page preparation snapshot is unavailable.",
      userMessageKey: "errors.pagePreparationMissing",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "PreparationSnapshotMissing",
      safeContext: { preparationId: request.payload.preparationId },
    });
  }

  const report = await restoreSnapshot(state, active, true);
  return responseEnvelope(request, "PAGE_PREPARATION_RESTORED", report);
}

function handleCancel(
  state: PagePreparationRuntimeState,
  request: PageCancelRequest,
): Record<string, unknown> {
  const active = state.active;
  const accepted = active !== undefined && active.preparationId === request.payload.preparationId;
  if (accepted && active !== undefined) {
    active.cancelled = true;
  }
  return responseEnvelope(request, "PAGE_PREPARATION_CANCELLED", {
    preparationId: request.payload.preparationId,
    accepted,
  });
}

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

function installRuntime(): { installed: boolean; reused: boolean; protocolVersion: number } {
  const carrier = globalThis as typeof globalThis & StateCarrier;
  const existing = carrier[PAGE_PREPARATION_GLOBAL_KEY];
  if (existing?.version === PAGE_PREPARATION_PROTOCOL_VERSION) {
    ensureRegionSelectionRuntime(existing);
    return { installed: true, reused: true, protocolVersion: existing.version };
  }

  const state: PagePreparationRuntimeState = {
    version: PAGE_PREPARATION_PROTOCOL_VERSION,
    completedReports: new Map(),
    listener: () => false,
    pageHideListener: () => undefined,
  };

  state.listener = (message, sender, sendResponse) => {
    if (!isPagePreparationRequest(message) || sender.id !== chrome.runtime.id) {
      return false;
    }

    const operation =
      message.type === "PAGE_PREPARATION_PREPARE"
        ? handlePrepare(state, message)
        : message.type === "PAGE_PREPARATION_RESTORE"
          ? handleRestore(state, message)
          : Promise.resolve(handleCancel(state, message));

    void operation
      .then((response) => sendResponse(response))
      .catch((error: unknown) => sendResponse(errorResponse(message, error)));
    return true;
  };

  state.pageHideListener = () => {
    const active = state.active;
    if (active !== undefined) {
      void restoreSnapshot(state, active, false);
    }
  };

  chrome.runtime.onMessage.addListener(state.listener);
  window.addEventListener("pagehide", state.pageHideListener, { once: true });
  ensureRegionSelectionRuntime(state);
  carrier[PAGE_PREPARATION_GLOBAL_KEY] = state;
  return { installed: true, reused: false, protocolVersion: state.version };
}

export function registerPagePreparationContentScript(): {
  installed: boolean;
  reused: boolean;
  protocolVersion: number;
} {
  return installRuntime();
}

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  registerPagePreparationContentScript();
}
