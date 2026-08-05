import {
  openElementSelector,
  isScrollableElement,
  readElementDocumentRect,
  readElementScrollContentRect,
  type ElementSelection,
  type ElementSelectorController,
} from "./element-selector";
import { openRegionSelector, type RegionSelectorController } from "./region-selector";
import type { ElementTargetDescriptor, FixedElementMode, Rect } from "@shared/contracts/domain";
import { loadUiLocale } from "@shared/ui-locale";
import type {
  ScrollAreaCleanupMessage,
  ScrollAreaScrollMessage,
} from "@shared/contracts/scroll-area";

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
    "html, body, * {",
    "  scroll-snap-type: none !important;",
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
  completionReason: "lazy-disabled" | "stable" | "max-css-height" | "max-duration";
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
  let completionReason: "lazy-disabled" | "stable" | "max-css-height" | "max-duration" = options
    .lazyLoad.enabled
    ? "stable"
    : "lazy-disabled";
  const deadline = Date.now() + maxDurationMs;

  if (options.lazyLoad.enabled) {
    while (Date.now() < deadline) {
      throwIfCancelled(active);
      const size = readDocumentSize();
      if (size.height >= options.maxCssHeight) {
        reachedLimit = true;
        completionReason = "max-css-height";
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
        completionReason = "max-duration";
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

    if (Date.now() >= deadline && !reachedLimit) {
      reachedLimit = true;
      completionReason = "max-duration";
    }
  }

  throwIfCancelled(active);
  scrollPreparedPage(active, targetStartX, targetStartY);
  const finalSettle = await waitForLayoutSettle(active, settleMs, Math.max(1_000, settleMs * 8), 2);
  stableSamples += finalSettle.stableSamples;
  mutationCount += finalSettle.mutationCount;

  return {
    reachedLimit,
    completionReason,
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
      completionReason: settle.completionReason,
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

interface RegionSelectionCloseRequest {
  protocolVersion: 1;
  requestId: string;
  source: "background";
  target: "content";
  type: "REGION_SELECTION_CLOSE";
  payload: { jobId: string };
  sentAt: string;
}

type RegionSelectionRequest = RegionSelectionOpenRequest | RegionSelectionCloseRequest;

function isRegionSelectionRequest(value: unknown): value is RegionSelectionRequest {
  return (
    isRecord(value) &&
    value.protocolVersion === PAGE_PREPARATION_PROTOCOL_VERSION &&
    value.source === "background" &&
    value.target === "content" &&
    (value.type === "REGION_SELECTION_OPEN" || value.type === "REGION_SELECTION_CLOSE") &&
    hasString(value, "requestId") &&
    hasString(value, "sentAt") &&
    isRecord(value.payload) &&
    hasString(value.payload, "jobId")
  );
}

function regionSelectionResponse(
  request: RegionSelectionRequest,
  type: "REGION_SELECTION_OPENED" | "REGION_SELECTION_CLOSED" | "REGION_SELECTION_ERROR",
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
  request: RegionSelectionRequest,
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
    if (!isRegionSelectionRequest(message) || sender.id !== chrome.runtime.id) {
      return false;
    }

    const current = state.region;
    if (message.type === "REGION_SELECTION_CLOSE") {
      const closed = current?.jobId === message.payload.jobId;
      if (current?.jobId === message.payload.jobId) {
        current.dispose();
        delete state.region;
      }
      sendResponse(
        regionSelectionResponse(message, "REGION_SELECTION_CLOSED", {
          jobId: message.payload.jobId,
          closed,
        }),
      );
      return false;
    }
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

    void loadUiLocale()
      .then((locale) => {
        state.region = openRegionSelector({
          jobId: message.payload.jobId,
          locale,
          onCommit: async (rect) => {
            delete state.region;
            await sendRegionSelectionEvent("REGION_SELECTION_COMMIT", message.payload.jobId, {
              rect,
            });
          },
          onCancel: async (reason) => {
            delete state.region;
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
      })
      .catch((error: unknown) => {
        sendResponse(
          regionSelectionError(
            message,
            error instanceof Error ? error.message : "Region selector could not be created.",
            error instanceof Error ? error.name : "RegionSelectionOpenFailure",
          ),
        );
      });
    return true;
  };

  state.regionPageHideListener = () => {
    state.region?.dispose();
    delete state.region;
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

const ELEMENT_SELECTION_GLOBAL_KEY = "__webcapElementSelectionV1__" as const;

interface ElementSelectionOpenRequest {
  protocolVersion: 1;
  requestId: string;
  source: "background";
  target: "content";
  type: "ELEMENT_SELECTION_OPEN";
  payload: {
    jobId: string;
    captureKind: ElementTargetDescriptor["captureKind"];
  };
  sentAt: string;
}

interface ElementSelectionCloseRequest {
  protocolVersion: 1;
  requestId: string;
  source: "background";
  target: "content";
  type: "ELEMENT_SELECTION_CLOSE";
  payload: { jobId: string };
  sentAt: string;
}

interface ElementTargetRevalidateRequest {
  protocolVersion: 1;
  requestId: string;
  source: "background";
  target: "content";
  type: "ELEMENT_TARGET_REVALIDATE";
  payload: { jobId: string; descriptor: ElementTargetDescriptor };
  sentAt: string;
}

type ElementSelectionRequest =
  ElementSelectionOpenRequest | ElementSelectionCloseRequest | ElementTargetRevalidateRequest;

interface ScrollAreaStyleMutation {
  element: HTMLElement;
  beforeStyle: string | null;
  appliedStyle: string | null;
}

interface ScrollAreaTargetSnapshot {
  originalScrollLeft: number;
  originalScrollTop: number;
  originalDocumentScrollX: number;
  originalDocumentScrollY: number;
  mutations: ScrollAreaStyleMutation[];
}

interface StoredElementTarget {
  jobId: string;
  element: Element;
  descriptor: ElementTargetDescriptor;
  scrollAreaSnapshot?: ScrollAreaTargetSnapshot;
}

interface ElementSelectionRuntimeState {
  version: 1;
  controller?: ElementSelectorController;
  targets: Map<string, StoredElementTarget>;
  listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void;
  pageHideListener: () => void;
}

interface ElementSelectionStateCarrier {
  [ELEMENT_SELECTION_GLOBAL_KEY]?: ElementSelectionRuntimeState;
}

function isElementTargetDescriptor(value: unknown): value is ElementTargetDescriptor {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    hasString(value, "selectionId") &&
    hasString(value, "tagName") &&
    Array.isArray(value.classNames) &&
    value.classNames.every((item) => typeof item === "string") &&
    typeof value.scrollable === "boolean" &&
    (value.captureKind === "visible-bounds" || value.captureKind === "full-scroll-content")
  );
}

function isElementSelectionRequest(value: unknown): value is ElementSelectionRequest {
  if (
    !isRecord(value) ||
    value.protocolVersion !== PAGE_PREPARATION_PROTOCOL_VERSION ||
    value.source !== "background" ||
    value.target !== "content" ||
    !hasString(value, "requestId") ||
    !hasString(value, "sentAt") ||
    !isRecord(value.payload) ||
    !hasString(value.payload, "jobId")
  ) {
    return false;
  }
  return (
    value.type === "ELEMENT_SELECTION_CLOSE" ||
    (value.type === "ELEMENT_SELECTION_OPEN" &&
      (value.payload.captureKind === "visible-bounds" ||
        value.payload.captureKind === "full-scroll-content")) ||
    (value.type === "ELEMENT_TARGET_REVALIDATE" &&
      isElementTargetDescriptor(value.payload.descriptor))
  );
}

function elementSelectionResponse(
  request: ElementSelectionRequest,
  type:
    | "ELEMENT_SELECTION_OPENED"
    | "ELEMENT_SELECTION_CLOSED"
    | "ELEMENT_TARGET_VALIDATED"
    | "ELEMENT_SELECTION_ERROR",
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

function elementSelectionFailure(
  request: ElementSelectionRequest,
  options: { code?: "E_PROTOCOL_MESSAGE" | "E_TARGET_STALE"; message: string; causeCode: string },
): Record<string, unknown> {
  return elementSelectionResponse(request, "ELEMENT_SELECTION_ERROR", {
    code: options.code ?? "E_PROTOCOL_MESSAGE",
    stage: options.code === "E_TARGET_STALE" ? "capture" : "protocol",
    message: options.message,
    userMessageKey:
      options.code === "E_TARGET_STALE" ? "errors.targetStale" : "errors.elementSelection",
    retryable: options.code === "E_TARGET_STALE",
    fallbackAllowed: false,
    causeCode: options.causeCode,
    safeContext: { jobId: request.payload.jobId },
  });
}

async function sendElementSelectionEvent(
  type: "ELEMENT_SELECTION_COMMIT" | "ELEMENT_SELECTION_CANCEL",
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isScrollAreaScrollRequest(value: unknown): value is ScrollAreaScrollMessage {
  if (!isRecord(value) || value.type !== "SCROLL_AREA_SCROLL" || !isRecord(value.payload)) {
    return false;
  }
  const payload = value.payload;
  return (
    value.protocolVersion === PAGE_PREPARATION_PROTOCOL_VERSION &&
    value.source === "background" &&
    value.target === "content" &&
    hasString(value, "requestId") &&
    hasString(value, "sentAt") &&
    hasString(payload, "jobId") &&
    isElementTargetDescriptor(payload.descriptor) &&
    payload.descriptor.captureKind === "full-scroll-content" &&
    isFiniteNumber(payload.scrollLeft) &&
    payload.scrollLeft >= 0 &&
    isFiniteNumber(payload.scrollTop) &&
    payload.scrollTop >= 0 &&
    Number.isInteger(payload.row) &&
    isFiniteNumber(payload.row) &&
    payload.row >= 0 &&
    Number.isInteger(payload.column) &&
    isFiniteNumber(payload.column) &&
    payload.column >= 0 &&
    Number.isInteger(payload.rows) &&
    isFiniteNumber(payload.rows) &&
    payload.rows > 0 &&
    Number.isInteger(payload.columns) &&
    isFiniteNumber(payload.columns) &&
    payload.columns > 0 &&
    (payload.fixedElementMode === "preserve" ||
      payload.fixedElementMode === "remove" ||
      payload.fixedElementMode === "smart") &&
    Number.isInteger(payload.settleMs) &&
    isFiniteNumber(payload.settleMs) &&
    payload.settleMs >= 0 &&
    (payload.expectedScrollWidth === undefined ||
      (isFiniteNumber(payload.expectedScrollWidth) && payload.expectedScrollWidth > 0)) &&
    (payload.expectedScrollHeight === undefined ||
      (isFiniteNumber(payload.expectedScrollHeight) && payload.expectedScrollHeight > 0)) &&
    (payload.expectedClientWidth === undefined ||
      (isFiniteNumber(payload.expectedClientWidth) && payload.expectedClientWidth > 0)) &&
    (payload.expectedClientHeight === undefined ||
      (isFiniteNumber(payload.expectedClientHeight) && payload.expectedClientHeight > 0))
  );
}

function isScrollAreaCleanupRequest(value: unknown): value is ScrollAreaCleanupMessage {
  return (
    isRecord(value) &&
    value.type === "SCROLL_AREA_CLEANUP" &&
    value.protocolVersion === PAGE_PREPARATION_PROTOCOL_VERSION &&
    value.source === "background" &&
    value.target === "content" &&
    hasString(value, "requestId") &&
    hasString(value, "sentAt") &&
    isRecord(value.payload) &&
    hasString(value.payload, "jobId") &&
    isElementTargetDescriptor(value.payload.descriptor) &&
    value.payload.descriptor.captureKind === "full-scroll-content"
  );
}

function scrollAreaResponse(
  request: ScrollAreaScrollMessage | ScrollAreaCleanupMessage,
  type: "SCROLL_AREA_SCROLLED" | "SCROLL_AREA_CLEANED" | "SCROLL_AREA_ERROR",
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

function scrollAreaFailure(
  request: ScrollAreaScrollMessage | ScrollAreaCleanupMessage,
  options: {
    code?: "E_PROTOCOL_MESSAGE" | "E_TARGET_STALE" | "E_LAYOUT_UNSTABLE" | "E_CLEANUP_PARTIAL";
    stage?: "capture" | "cleanup" | "protocol";
    message: string;
    causeCode: string;
    retryable?: boolean;
  },
): Record<string, unknown> {
  return scrollAreaResponse(request, "SCROLL_AREA_ERROR", {
    code: options.code ?? "E_PROTOCOL_MESSAGE",
    stage: options.stage ?? "capture",
    message: options.message,
    userMessageKey:
      options.code === "E_TARGET_STALE" ? "errors.targetStale" : "errors.scrollAreaCapture",
    retryable: options.retryable ?? true,
    fallbackAllowed: false,
    causeCode: options.causeCode,
    safeContext: { jobId: request.payload.jobId },
  });
}

function restoreScrollAreaMutations(snapshot: ScrollAreaTargetSnapshot): {
  restored: number;
  skipped: number;
} {
  let restored = 0;
  let skipped = 0;
  for (const mutation of snapshot.mutations.splice(0)) {
    if (!mutation.element.isConnected) {
      skipped += 1;
      continue;
    }
    if (mutation.element.getAttribute("style") === mutation.appliedStyle) {
      if (mutation.beforeStyle === null) mutation.element.removeAttribute("style");
      else mutation.element.setAttribute("style", mutation.beforeStyle);
      restored += 1;
    } else {
      skipped += 1;
    }
  }
  return { restored, skipped };
}

function applyScrollAreaStickyPolicy(
  target: HTMLElement,
  snapshot: ScrollAreaTargetSnapshot,
  fixedElementMode: FixedElementMode,
  row: number,
  column: number,
  rows: number,
  columns: number,
): number {
  restoreScrollAreaMutations(snapshot);
  if (fixedElementMode === "preserve") return 0;
  const targetRect = target.getBoundingClientRect();
  let hidden = 0;
  for (const element of Array.from(target.querySelectorAll<HTMLElement>("*"))) {
    const style = getComputedStyle(element);
    if (style.position !== "sticky") continue;
    const rect = element.getBoundingClientRect();
    const visible =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number.parseFloat(style.opacity || "1") > 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > targetRect.left &&
      rect.bottom > targetRect.top &&
      rect.left < targetRect.right &&
      rect.top < targetRect.bottom;
    if (!visible) continue;
    const touchesTop = rect.top <= targetRect.top + target.clientTop + 1;
    const touchesBottom =
      rect.bottom >= targetRect.top + target.clientTop + target.clientHeight - 1;
    const touchesLeft = rect.left <= targetRect.left + target.clientLeft + 1;
    const touchesRight = rect.right >= targetRect.left + target.clientLeft + target.clientWidth - 1;
    const shouldHide =
      fixedElementMode === "remove" ||
      (fixedElementMode === "smart" &&
        ((touchesTop && row > 0) ||
          (touchesBottom && row < rows - 1) ||
          (touchesLeft && column > 0) ||
          (touchesRight && column < columns - 1)));
    if (!shouldHide) continue;
    const beforeStyle = element.getAttribute("style");
    element.style.setProperty("visibility", "hidden", "important");
    snapshot.mutations.push({
      element,
      beforeStyle,
      appliedStyle: element.getAttribute("style"),
    });
    hidden += 1;
  }
  return hidden;
}

function requireScrollAreaTarget(
  state: ElementSelectionRuntimeState,
  request: ScrollAreaScrollMessage | ScrollAreaCleanupMessage,
): StoredElementTarget | undefined {
  const stored = state.targets.get(request.payload.descriptor.selectionId);
  if (
    stored === undefined ||
    stored.jobId !== request.payload.jobId ||
    stored.descriptor.selectionId !== request.payload.descriptor.selectionId ||
    stored.descriptor.captureKind !== "full-scroll-content" ||
    !stored.element.isConnected ||
    !isScrollableElement(stored.element)
  ) {
    return undefined;
  }
  return stored;
}

async function handleScrollAreaScroll(
  state: ElementSelectionRuntimeState,
  request: ScrollAreaScrollMessage,
): Promise<Record<string, unknown>> {
  const stored = requireScrollAreaTarget(state, request);
  if (stored === undefined || !(stored.element instanceof HTMLElement)) {
    return scrollAreaFailure(request, {
      code: "E_TARGET_STALE",
      message: "The selected scrollable container is no longer available.",
      causeCode: "ScrollAreaTargetUnavailable",
    });
  }
  const target = stored.element;
  const snapshot =
    stored.scrollAreaSnapshot ??
    ({
      originalScrollLeft: target.scrollLeft,
      originalScrollTop: target.scrollTop,
      originalDocumentScrollX: window.scrollX,
      originalDocumentScrollY: window.scrollY,
      mutations: [],
    } satisfies ScrollAreaTargetSnapshot);
  stored.scrollAreaSnapshot = snapshot;

  restoreScrollAreaMutations(snapshot);
  target.scrollLeft = Math.max(0, request.payload.scrollLeft);
  target.scrollTop = Math.max(0, request.payload.scrollTop);
  await waitForFrames(2);

  let mutationCount = 0;
  let stableSamples = 0;
  let previous = "";
  const observer = new MutationObserver(() => {
    mutationCount += 1;
  });
  observer.observe(target, { attributes: true, childList: true, subtree: true });
  try {
    for (let index = 0; index < 4; index += 1) {
      await waitForDelay(Math.min(5_000, Math.max(0, request.payload.settleMs)));
      await waitForFrames(2);
      const sample = `${target.scrollWidth}:${target.scrollHeight}:${target.clientWidth}:${target.clientHeight}:${mutationCount}`;
      stableSamples = sample === previous ? stableSamples + 1 : 0;
      previous = sample;
      if (stableSamples >= 1) break;
    }
  } finally {
    observer.disconnect();
  }

  if (!target.isConnected || !isScrollableElement(target)) {
    return scrollAreaFailure(request, {
      code: "E_TARGET_STALE",
      message: "The selected scrollable container changed before capture.",
      causeCode: "ScrollAreaTargetDisconnected",
    });
  }

  const hiddenStickyElements = applyScrollAreaStickyPolicy(
    target,
    snapshot,
    request.payload.fixedElementMode,
    request.payload.row,
    request.payload.column,
    request.payload.rows,
    request.payload.columns,
  );
  await waitForFrames(2);

  const rect = target.getBoundingClientRect();
  const captureCropCss: Rect = {
    x: rect.left + target.clientLeft,
    y: rect.top + target.clientTop,
    width: target.clientWidth,
    height: target.clientHeight,
  };
  const tolerance = 1;
  if (
    captureCropCss.x < -tolerance ||
    captureCropCss.y < -tolerance ||
    captureCropCss.x + captureCropCss.width > window.innerWidth + tolerance ||
    captureCropCss.y + captureCropCss.height > window.innerHeight + tolerance
  ) {
    return scrollAreaFailure(request, {
      code: "E_LAYOUT_UNSTABLE",
      message: "The selected scrollable container cannot be fully exposed inside the viewport.",
      causeCode: "ScrollAreaNotFullyVisible",
    });
  }

  const scrollWidth = Math.max(1, target.scrollWidth);
  const scrollHeight = Math.max(1, target.scrollHeight);
  const clientWidth = Math.max(1, target.clientWidth);
  const clientHeight = Math.max(1, target.clientHeight);
  const actualScrollLeft = Math.max(0, target.scrollLeft);
  const actualScrollTop = Math.max(0, target.scrollTop);
  const scrollSnapped =
    Math.abs(actualScrollLeft - request.payload.scrollLeft) > 1 ||
    Math.abs(actualScrollTop - request.payload.scrollTop) > 1;
  const layoutChanged =
    (request.payload.expectedScrollWidth !== undefined &&
      Math.abs(scrollWidth - request.payload.expectedScrollWidth) > 2) ||
    (request.payload.expectedScrollHeight !== undefined &&
      Math.abs(scrollHeight - request.payload.expectedScrollHeight) > 2) ||
    (request.payload.expectedClientWidth !== undefined &&
      Math.abs(clientWidth - request.payload.expectedClientWidth) > 2) ||
    (request.payload.expectedClientHeight !== undefined &&
      Math.abs(clientHeight - request.payload.expectedClientHeight) > 2);

  return scrollAreaResponse(request, "SCROLL_AREA_SCROLLED", {
    jobId: stored.jobId,
    descriptor: stored.descriptor,
    requestedScrollLeft: request.payload.scrollLeft,
    requestedScrollTop: request.payload.scrollTop,
    actualScrollLeft,
    actualScrollTop,
    scrollWidth,
    scrollHeight,
    clientWidth,
    clientHeight,
    viewportWidth: Math.max(1, window.innerWidth),
    viewportHeight: Math.max(1, window.innerHeight),
    devicePixelRatio: Math.max(0.01, window.devicePixelRatio || 1),
    captureCropCss,
    hiddenStickyElements,
    stableSamples,
    mutationCount,
    scrollSnapped,
    layoutChanged,
  });
}

async function handleScrollAreaCleanup(
  state: ElementSelectionRuntimeState,
  request: ScrollAreaCleanupMessage,
): Promise<Record<string, unknown>> {
  const stored = state.targets.get(request.payload.descriptor.selectionId);
  const snapshot = stored?.scrollAreaSnapshot;
  if (stored === undefined || snapshot === undefined || !(stored.element instanceof HTMLElement)) {
    return scrollAreaResponse(request, "SCROLL_AREA_CLEANED", {
      jobId: request.payload.jobId,
      restoredElements: 0,
      skippedElements: 0,
      scrollRestored: true,
      documentScrollRestored: true,
    });
  }
  const mutations = restoreScrollAreaMutations(snapshot);
  let scrollRestored = false;
  let documentScrollRestored = false;
  if (stored.element.isConnected) {
    stored.element.scrollLeft = snapshot.originalScrollLeft;
    stored.element.scrollTop = snapshot.originalScrollTop;
    await waitForFrames(2);
    scrollRestored =
      Math.abs(stored.element.scrollLeft - snapshot.originalScrollLeft) <= 1 &&
      Math.abs(stored.element.scrollTop - snapshot.originalScrollTop) <= 1;
  }
  window.scrollTo({
    left: snapshot.originalDocumentScrollX,
    top: snapshot.originalDocumentScrollY,
    behavior: "auto",
  });
  await waitForFrames(2);
  documentScrollRestored =
    Math.abs(window.scrollX - snapshot.originalDocumentScrollX) <= 1 &&
    Math.abs(window.scrollY - snapshot.originalDocumentScrollY) <= 1;
  delete stored.scrollAreaSnapshot;
  return scrollAreaResponse(request, "SCROLL_AREA_CLEANED", {
    jobId: stored.jobId,
    restoredElements: mutations.restored,
    skippedElements: mutations.skipped,
    scrollRestored,
    documentScrollRestored,
  });
}

function installElementSelectionRuntime(): { installed: boolean; reused: boolean } {
  const carrier = globalThis as typeof globalThis & ElementSelectionStateCarrier;
  const existing = carrier[ELEMENT_SELECTION_GLOBAL_KEY];
  if (existing?.version === PAGE_PREPARATION_PROTOCOL_VERSION) {
    return { installed: true, reused: true };
  }

  const state: ElementSelectionRuntimeState = {
    version: PAGE_PREPARATION_PROTOCOL_VERSION,
    targets: new Map(),
    listener: () => false,
    pageHideListener: () => undefined,
  };

  state.listener = (message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;

    if (isScrollAreaScrollRequest(message)) {
      void handleScrollAreaScroll(state, message)
        .then(sendResponse)
        .catch((error: unknown) =>
          sendResponse(
            scrollAreaFailure(message, {
              code: "E_LAYOUT_UNSTABLE",
              message:
                error instanceof Error ? error.message : "Scrollable container capture failed.",
              causeCode: error instanceof Error ? error.name : "ScrollAreaCaptureFailure",
            }),
          ),
        );
      return true;
    }
    if (isScrollAreaCleanupRequest(message)) {
      void handleScrollAreaCleanup(state, message)
        .then(sendResponse)
        .catch((error: unknown) =>
          sendResponse(
            scrollAreaFailure(message, {
              code: "E_CLEANUP_PARTIAL",
              stage: "cleanup",
              message:
                error instanceof Error ? error.message : "Scrollable container cleanup failed.",
              causeCode: error instanceof Error ? error.name : "ScrollAreaCleanupFailure",
            }),
          ),
        );
      return true;
    }
    if (!isElementSelectionRequest(message)) return false;

    if (message.type === "ELEMENT_SELECTION_CLOSE") {
      const controller = state.controller;
      let closed = controller?.jobId === message.payload.jobId;
      if (controller?.jobId === message.payload.jobId) {
        controller.dispose();
        delete state.controller;
      }
      for (const [selectionId, target] of state.targets) {
        if (target.jobId !== message.payload.jobId) continue;
        if (target.scrollAreaSnapshot !== undefined) {
          restoreScrollAreaMutations(target.scrollAreaSnapshot);
          if (target.element instanceof HTMLElement && target.element.isConnected) {
            target.element.scrollLeft = target.scrollAreaSnapshot.originalScrollLeft;
            target.element.scrollTop = target.scrollAreaSnapshot.originalScrollTop;
          }
          window.scrollTo({
            left: target.scrollAreaSnapshot.originalDocumentScrollX,
            top: target.scrollAreaSnapshot.originalDocumentScrollY,
            behavior: "auto",
          });
        }
        state.targets.delete(selectionId);
        closed = true;
      }
      sendResponse(
        elementSelectionResponse(message, "ELEMENT_SELECTION_CLOSED", {
          jobId: message.payload.jobId,
          closed,
        }),
      );
      return false;
    }

    if (message.type === "ELEMENT_TARGET_REVALIDATE") {
      const stored = state.targets.get(message.payload.descriptor.selectionId);
      if (
        stored === undefined ||
        stored.jobId !== message.payload.jobId ||
        stored.descriptor.selectionId !== message.payload.descriptor.selectionId ||
        !stored.element.isConnected
      ) {
        sendResponse(
          elementSelectionFailure(message, {
            code: "E_TARGET_STALE",
            message: "The selected element no longer exists on the page.",
            causeCode: "ElementTargetDisconnected",
          }),
        );
        return false;
      }
      const rect =
        stored.descriptor.captureKind === "full-scroll-content"
          ? readElementScrollContentRect(stored.element)
          : readElementDocumentRect(stored.element);
      if (rect.width < 1 || rect.height < 1) {
        sendResponse(
          elementSelectionFailure(message, {
            code: "E_TARGET_STALE",
            message: "The selected element no longer has capturable bounds.",
            causeCode: "ElementTargetBoundsEmpty",
          }),
        );
        return false;
      }
      sendResponse(
        elementSelectionResponse(message, "ELEMENT_TARGET_VALIDATED", {
          jobId: stored.jobId,
          descriptor: stored.descriptor,
          rect,
        }),
      );
      return false;
    }

    const current = state.controller;
    if (current?.jobId === message.payload.jobId) {
      sendResponse(
        elementSelectionResponse(message, "ELEMENT_SELECTION_OPENED", {
          jobId: message.payload.jobId,
          reused: true,
        }),
      );
      return false;
    }
    if (current !== undefined) {
      sendResponse(
        elementSelectionFailure(message, {
          message: "This page already has an active WebCap element selector.",
          causeCode: "ActiveElementSelectionConflict",
        }),
      );
      return false;
    }

    void loadUiLocale()
      .then((locale) => {
        state.controller = openElementSelector({
          jobId: message.payload.jobId,
          captureKind: message.payload.captureKind,
          locale,
          onCommit: async (selection: ElementSelection) => {
            delete state.controller;
            state.targets.set(selection.descriptor.selectionId, {
              jobId: message.payload.jobId,
              element: selection.element,
              descriptor: selection.descriptor,
            });
            await sendElementSelectionEvent("ELEMENT_SELECTION_COMMIT", message.payload.jobId, {
              rect: selection.rect,
              descriptor: selection.descriptor,
            });
          },
          onCancel: async (reason) => {
            delete state.controller;
            await sendElementSelectionEvent("ELEMENT_SELECTION_CANCEL", message.payload.jobId, {
              reason,
            });
          },
        });
        sendResponse(
          elementSelectionResponse(message, "ELEMENT_SELECTION_OPENED", {
            jobId: message.payload.jobId,
            reused: false,
          }),
        );
      })
      .catch((error: unknown) => {
        sendResponse(
          elementSelectionFailure(message, {
            message:
              error instanceof Error ? error.message : "Element selector could not be created.",
            causeCode: error instanceof Error ? error.name : "ElementSelectionOpenFailure",
          }),
        );
      });
    return true;
  };

  state.pageHideListener = () => {
    state.controller?.dispose();
    delete state.controller;
    for (const target of state.targets.values()) {
      if (target.scrollAreaSnapshot !== undefined) {
        restoreScrollAreaMutations(target.scrollAreaSnapshot);
        if (target.element instanceof HTMLElement && target.element.isConnected) {
          target.element.scrollLeft = target.scrollAreaSnapshot.originalScrollLeft;
          target.element.scrollTop = target.scrollAreaSnapshot.originalScrollTop;
        }
        window.scrollTo({
          left: target.scrollAreaSnapshot.originalDocumentScrollX,
          top: target.scrollAreaSnapshot.originalDocumentScrollY,
          behavior: "auto",
        });
      }
    }
    state.targets.clear();
  };
  chrome.runtime.onMessage.addListener(state.listener);
  window.addEventListener("pagehide", state.pageHideListener, { once: true });
  carrier[ELEMENT_SELECTION_GLOBAL_KEY] = state;
  return { installed: true, reused: false };
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
  installElementSelectionRuntime();
}
