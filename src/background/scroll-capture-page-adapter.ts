import { z } from "zod";

import type { FixedElementMode } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";

export interface ScrollCapturePageRequest {
  tabId: number;
  preparationId: string;
  scrollX: number;
  scrollY: number;
  tileIndex: number;
  totalTiles: number;
  fixedElementMode: FixedElementMode;
  settleMs: number;
  expectedDocumentWidth: number;
  expectedDocumentHeight: number;
  isFirstRow?: boolean;
  isFinalRow?: boolean;
}

export interface ScrollCapturePageResult {
  requestedScrollX: number;
  requestedScrollY: number;
  actualScrollX: number;
  actualScrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
  devicePixelRatio: number;
  documentToken: string;
  fixedCandidates: number;
  hiddenFixedElements: number;
  stableSamples: number;
  mutationCount: number;
  scrollSnapped: boolean;
  layoutChanged: boolean;
}

export interface ScrollCaptureCleanupResult {
  restoredElements: number;
  skippedElements: number;
  actualScrollX: number;
  actualScrollY: number;
}

export interface ScrollCapturePageAdapter {
  scrollAndSettle(request: ScrollCapturePageRequest): Promise<ScrollCapturePageResult>;
  cleanup(
    tabId: number,
    preparationId: string,
    returnX: number,
    returnY: number,
  ): Promise<ScrollCaptureCleanupResult>;
}

const ScrollCapturePageResultSchema = z
  .object({
    requestedScrollX: z.number().finite().nonnegative(),
    requestedScrollY: z.number().finite().nonnegative(),
    actualScrollX: z.number().finite().nonnegative(),
    actualScrollY: z.number().finite().nonnegative(),
    viewportWidth: z.number().finite().positive(),
    viewportHeight: z.number().finite().positive(),
    documentWidth: z.number().finite().positive(),
    documentHeight: z.number().finite().positive(),
    devicePixelRatio: z.number().finite().positive(),
    documentToken: z.string().min(1).max(240),
    fixedCandidates: z.number().int().nonnegative(),
    hiddenFixedElements: z.number().int().nonnegative(),
    stableSamples: z.number().int().nonnegative(),
    mutationCount: z.number().int().nonnegative(),
    scrollSnapped: z.boolean(),
    layoutChanged: z.boolean(),
  })
  .strict();

const ScrollCaptureCleanupResultSchema = z
  .object({
    restoredElements: z.number().int().nonnegative(),
    skippedElements: z.number().int().nonnegative(),
    actualScrollX: z.number().finite().nonnegative(),
    actualScrollY: z.number().finite().nonnegative(),
  })
  .strict();

function invalidInjectionResult(tabId: number, operation: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: operation === "cleanup" ? "cleanup" : "capture",
      message: "The scroll capture page script returned an invalid result.",
      userMessageKey: "errors.scrollCaptureProtocol",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "InvalidExecuteScriptResult",
      safeContext: { tabId, operation },
    }),
  );
}

async function executeScrollCapture(
  request: Omit<ScrollCapturePageRequest, "tabId">,
): Promise<ScrollCapturePageResult> {
  const PREPARATION_ATTRIBUTE = "data-webcap-scroll-preparation";
  const ORIGINAL_STYLE_ATTRIBUTE = "data-webcap-scroll-original-style";
  const APPLIED_STYLE_ATTRIBUTE = "data-webcap-scroll-applied-style";
  const HAD_STYLE_ATTRIBUTE = "data-webcap-scroll-had-style";

  const waitForFrame = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  const waitForDelay = (milliseconds: number) =>
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, Math.max(0, milliseconds));
    });
  const readSize = () => {
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
  };
  const restoreMarked = () => {
    let restored = 0;
    let skipped = 0;
    const marked = Array.from(document.querySelectorAll<HTMLElement>(`[${PREPARATION_ATTRIBUTE}]`));
    for (const element of marked) {
      if (element.getAttribute(PREPARATION_ATTRIBUTE) !== request.preparationId) {
        continue;
      }
      const appliedStyle = element.getAttribute(APPLIED_STYLE_ATTRIBUTE);
      const currentStyle = element.getAttribute("style");
      if (currentStyle === appliedStyle) {
        if (element.getAttribute(HAD_STYLE_ATTRIBUTE) === "1") {
          element.setAttribute("style", element.getAttribute(ORIGINAL_STYLE_ATTRIBUTE) ?? "");
        } else {
          element.removeAttribute("style");
        }
        restored += 1;
      } else {
        skipped += 1;
      }
      element.removeAttribute(PREPARATION_ATTRIBUTE);
      element.removeAttribute(ORIGINAL_STYLE_ATTRIBUTE);
      element.removeAttribute(APPLIED_STYLE_ATTRIBUTE);
      element.removeAttribute(HAD_STYLE_ATTRIBUTE);
    }
    return { restored, skipped };
  };

  restoreMarked();
  const requestedScrollX = Math.max(0, request.scrollX);
  const requestedScrollY = Math.max(0, request.scrollY);
  window.scrollTo({ left: requestedScrollX, top: requestedScrollY, behavior: "auto" });
  await waitForFrame();
  await waitForFrame();

  const root = document.documentElement;
  let mutationCount = 0;
  const observer = new MutationObserver(() => {
    mutationCount += 1;
  });
  if (root !== null) {
    observer.observe(root, { attributes: true, childList: true, subtree: true });
  }

  let stableSamples = 0;
  let previousWidth = -1;
  let previousHeight = -1;
  let previousMutationCount = -1;
  try {
    for (let sampleIndex = 0; sampleIndex < 4; sampleIndex += 1) {
      await waitForFrame();
      await waitForFrame();
      await waitForDelay(Math.min(5_000, Math.max(0, request.settleMs)));
      const size = readSize();
      const stable =
        Math.abs(size.width - previousWidth) <= 0.5 &&
        Math.abs(size.height - previousHeight) <= 0.5 &&
        mutationCount === previousMutationCount;
      stableSamples = stable ? stableSamples + 1 : 0;
      previousWidth = size.width;
      previousHeight = size.height;
      previousMutationCount = mutationCount;
      if (stableSamples >= 1) {
        break;
      }
    }
  } finally {
    observer.disconnect();
  }

  const isFirstRow = request.isFirstRow ?? request.tileIndex === 0;
  const isFinalRow = request.isFinalRow ?? request.tileIndex >= request.totalTiles - 1;
  let fixedCandidates = 0;
  let hiddenFixedElements = 0;
  if (request.fixedElementMode !== "preserve" && document.body !== null) {
    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const style = getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "sticky") {
        continue;
      }
      const rect = element.getBoundingClientRect();
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight;
      if (!visible) {
        continue;
      }
      fixedCandidates += 1;
      const touchesTop = rect.top <= 1 && rect.bottom > 0;
      const touchesBottom = rect.bottom >= window.innerHeight - 1 && rect.top < window.innerHeight;
      const shouldHide =
        request.fixedElementMode === "remove" ||
        (request.fixedElementMode === "smart" &&
          ((touchesTop && !isFirstRow) || (touchesBottom && !isFinalRow)));
      if (!shouldHide) {
        continue;
      }

      const originalStyle = element.getAttribute("style");
      element.setAttribute(PREPARATION_ATTRIBUTE, request.preparationId);
      element.setAttribute(HAD_STYLE_ATTRIBUTE, originalStyle === null ? "0" : "1");
      element.setAttribute(ORIGINAL_STYLE_ATTRIBUTE, originalStyle ?? "");
      element.style.setProperty("visibility", "hidden", "important");
      element.setAttribute(APPLIED_STYLE_ATTRIBUTE, element.getAttribute("style") ?? "");
      hiddenFixedElements += 1;
    }
  }

  const size = readSize();
  const actualScrollX = Math.max(0, window.scrollX);
  const actualScrollY = Math.max(0, window.scrollY);
  return {
    requestedScrollX,
    requestedScrollY,
    actualScrollX,
    actualScrollY,
    viewportWidth: Math.max(1, window.innerWidth),
    viewportHeight: Math.max(1, window.innerHeight),
    documentWidth: Math.max(1, size.width),
    documentHeight: Math.max(1, size.height),
    devicePixelRatio: Math.max(0.01, window.devicePixelRatio || 1),
    documentToken: Math.round(performance.timeOrigin * 1_000).toString(36),
    fixedCandidates,
    hiddenFixedElements,
    stableSamples,
    mutationCount,
    scrollSnapped:
      Math.abs(actualScrollX - requestedScrollX) > 1 ||
      Math.abs(actualScrollY - requestedScrollY) > 1,
    layoutChanged:
      Math.abs(size.width - request.expectedDocumentWidth) > 2 ||
      Math.abs(size.height - request.expectedDocumentHeight) > 2,
  };
}

async function executeScrollCleanup(request: {
  preparationId: string;
  returnX: number;
  returnY: number;
}): Promise<ScrollCaptureCleanupResult> {
  const PREPARATION_ATTRIBUTE = "data-webcap-scroll-preparation";
  const ORIGINAL_STYLE_ATTRIBUTE = "data-webcap-scroll-original-style";
  const APPLIED_STYLE_ATTRIBUTE = "data-webcap-scroll-applied-style";
  const HAD_STYLE_ATTRIBUTE = "data-webcap-scroll-had-style";
  let restoredElements = 0;
  let skippedElements = 0;

  const marked = Array.from(document.querySelectorAll<HTMLElement>(`[${PREPARATION_ATTRIBUTE}]`));
  for (const element of marked) {
    if (element.getAttribute(PREPARATION_ATTRIBUTE) !== request.preparationId) {
      continue;
    }
    const appliedStyle = element.getAttribute(APPLIED_STYLE_ATTRIBUTE);
    if (element.getAttribute("style") === appliedStyle) {
      if (element.getAttribute(HAD_STYLE_ATTRIBUTE) === "1") {
        element.setAttribute("style", element.getAttribute(ORIGINAL_STYLE_ATTRIBUTE) ?? "");
      } else {
        element.removeAttribute("style");
      }
      restoredElements += 1;
    } else {
      skippedElements += 1;
    }
    element.removeAttribute(PREPARATION_ATTRIBUTE);
    element.removeAttribute(ORIGINAL_STYLE_ATTRIBUTE);
    element.removeAttribute(APPLIED_STYLE_ATTRIBUTE);
    element.removeAttribute(HAD_STYLE_ATTRIBUTE);
  }

  window.scrollTo({
    left: Math.max(0, request.returnX),
    top: Math.max(0, request.returnY),
    behavior: "auto",
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return {
    restoredElements,
    skippedElements,
    actualScrollX: Math.max(0, window.scrollX),
    actualScrollY: Math.max(0, window.scrollY),
  };
}

export function createChromeScrollCapturePageAdapter(): ScrollCapturePageAdapter {
  return {
    async scrollAndSettle(request) {
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: request.tabId },
          func: executeScrollCapture,
          args: [
            {
              preparationId: request.preparationId,
              scrollX: request.scrollX,
              scrollY: request.scrollY,
              tileIndex: request.tileIndex,
              totalTiles: request.totalTiles,
              fixedElementMode: request.fixedElementMode,
              settleMs: request.settleMs,
              expectedDocumentWidth: request.expectedDocumentWidth,
              expectedDocumentHeight: request.expectedDocumentHeight,
              ...(request.isFirstRow === undefined ? {} : { isFirstRow: request.isFirstRow }),
              ...(request.isFinalRow === undefined ? {} : { isFinalRow: request.isFinalRow }),
            },
          ],
        });
        const parsed = ScrollCapturePageResultSchema.safeParse(result);
        if (!parsed.success) {
          throw invalidInjectionResult(request.tabId, "scroll");
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof Error && error.name.startsWith("E_")) {
          throw error;
        }
        throw createWebCapRuntimeError(
          normalizeError(error, {
            code: "E_CDP_COMMAND",
            stage: "capture",
            userMessageKey: "errors.scrollCapturePage",
            retryable: true,
            fallbackAllowed: false,
            safeContext: { tabId: request.tabId },
          }),
        );
      }
    },
    async cleanup(tabId, preparationId, returnX, returnY) {
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId },
          func: executeScrollCleanup,
          args: [{ preparationId, returnX, returnY }],
        });
        const parsed = ScrollCaptureCleanupResultSchema.safeParse(result);
        if (!parsed.success) {
          throw invalidInjectionResult(tabId, "cleanup");
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof Error && error.name.startsWith("E_")) {
          throw error;
        }
        throw createWebCapRuntimeError(
          normalizeError(error, {
            code: "E_CLEANUP_PARTIAL",
            stage: "cleanup",
            userMessageKey: "errors.scrollCaptureCleanup",
            retryable: true,
            fallbackAllowed: false,
            safeContext: { tabId },
          }),
        );
      }
    },
  };
}
