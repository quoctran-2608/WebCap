import {
  ChromePdfViewerDiscovery,
  type PdfViewerDiscoveryPort,
} from "@background/pdf-viewer-discovery";
import type {
  DocumentPageMap,
  ElementTargetDescriptor,
  FixedElementMode,
  Rect,
} from "@shared/contracts/domain";
import { PAGE_PREPARATION_CONTENT_SCRIPT_FILE } from "@shared/contracts/page-preparation";
import {
  createScrollAreaCleanupMessage,
  createScrollAreaScrollMessage,
  parseScrollAreaCleanupResponse,
  parseScrollAreaScrollResponse,
} from "@shared/contracts/scroll-area";
import { createWebCapRuntimeError } from "@shared/errors/error";

export interface ScrollAreaPageRequest {
  tabId: number;
  jobId: string;
  descriptor: ElementTargetDescriptor;
  scrollLeft: number;
  scrollTop: number;
  row: number;
  column: number;
  rows: number;
  columns: number;
  fixedElementMode: FixedElementMode;
  settleMs: number;
  expectedScrollWidth?: number;
  expectedScrollHeight?: number;
  expectedClientWidth?: number;
  expectedClientHeight?: number;
}

export interface ScrollAreaPageResult {
  requestedScrollLeft: number;
  requestedScrollTop: number;
  actualScrollLeft: number;
  actualScrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  captureCropCss: Rect;
  hiddenStickyElements: number;
  stableSamples: number;
  mutationCount: number;
  scrollSnapped: boolean;
  layoutChanged: boolean;
  documentPageMap?: DocumentPageMap;
}

export interface ScrollAreaCleanupResult {
  restoredElements: number;
  skippedElements: number;
  scrollRestored: boolean;
  documentScrollRestored: boolean;
}

export interface ScrollAreaPageAdapter {
  scrollAndSettle(request: ScrollAreaPageRequest): Promise<ScrollAreaPageResult>;
  cleanup(
    tabId: number,
    jobId: string,
    descriptor: ElementTargetDescriptor,
  ): Promise<ScrollAreaCleanupResult>;
}

export interface ScrollAreaBrowserAdapter {
  injectContentScript(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export function createChromeScrollAreaBrowserAdapter(): ScrollAreaBrowserAdapter {
  return {
    async injectContentScript(tabId) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [PAGE_PREPARATION_CONTENT_SCRIPT_FILE],
      });
    },
    sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  };
}

function isInitialDiscoveryProbe(request: ScrollAreaPageRequest): boolean {
  return (
    request.scrollLeft === 0 &&
    request.scrollTop === 0 &&
    request.row === 0 &&
    request.column === 0 &&
    request.rows === 1 &&
    request.columns === 1
  );
}

function descriptorSuggestsPdf(descriptor: ElementTargetDescriptor): boolean {
  const hint = [descriptor.tagName, ...descriptor.classNames].join(" ");
  return /(pdf|document|viewer)/iu.test(hint);
}

function shouldDiscoverPdfViewer(
  request: ScrollAreaPageRequest,
  legacyPageMap: DocumentPageMap | undefined,
): boolean {
  return (
    isInitialDiscoveryProbe(request) &&
    (legacyPageMap !== undefined || descriptorSuggestsPdf(request.descriptor))
  );
}

function pageMapExtent(pageMap: DocumentPageMap | undefined): { right: number; bottom: number } {
  if (pageMap === undefined) return { right: 0, bottom: 0 };
  return pageMap.pages.reduce(
    (extent, page) => ({
      right: Math.max(extent.right, page.sourceRectCss.x + page.sourceRectCss.width),
      bottom: Math.max(extent.bottom, page.sourceRectCss.y + page.sourceRectCss.height),
    }),
    { right: 0, bottom: 0 },
  );
}

export class ChromeScrollAreaPageAdapter implements ScrollAreaPageAdapter {
  constructor(
    private readonly browser: ScrollAreaBrowserAdapter = createChromeScrollAreaBrowserAdapter(),
    private readonly now: () => Date = () => new Date(),
    private readonly requestId: () => string = () => crypto.randomUUID(),
    private readonly viewerDiscovery: PdfViewerDiscoveryPort = new ChromePdfViewerDiscovery(),
  ) {}

  async scrollAndSettle(request: ScrollAreaPageRequest): Promise<ScrollAreaPageResult> {
    await this.browser.injectContentScript(request.tabId);
    const requestId = this.requestId();
    const response = await this.browser.sendMessage(
      request.tabId,
      createScrollAreaScrollMessage({
        requestId,
        sentAt: this.now().toISOString(),
        jobId: request.jobId,
        descriptor: request.descriptor,
        scrollLeft: request.scrollLeft,
        scrollTop: request.scrollTop,
        row: request.row,
        column: request.column,
        rows: request.rows,
        columns: request.columns,
        fixedElementMode: request.fixedElementMode,
        settleMs: request.settleMs,
        ...(request.expectedScrollWidth === undefined
          ? {}
          : { expectedScrollWidth: request.expectedScrollWidth }),
        ...(request.expectedScrollHeight === undefined
          ? {}
          : { expectedScrollHeight: request.expectedScrollHeight }),
        ...(request.expectedClientWidth === undefined
          ? {}
          : { expectedClientWidth: request.expectedClientWidth }),
        ...(request.expectedClientHeight === undefined
          ? {}
          : { expectedClientHeight: request.expectedClientHeight }),
      }),
    );
    const parsed = parseScrollAreaScrollResponse(response, requestId);
    if (!parsed.ok) throw createWebCapRuntimeError(parsed.error);
    if (
      parsed.value.payload.jobId !== request.jobId ||
      parsed.value.payload.descriptor.selectionId !== request.descriptor.selectionId
    ) {
      throw new Error("Scrollable container response did not match the selected target.");
    }
    const payload = parsed.value.payload;
    const discoveryRan = shouldDiscoverPdfViewer(request, payload.documentPageMap);
    const discoveredPageMap = discoveryRan
      ? await this.viewerDiscovery.discover({
          tabId: request.tabId,
          jobId: request.jobId,
          descriptor: request.descriptor,
          settleMs: request.settleMs,
        })
      : undefined;
    const legacyDomPageMap =
      payload.documentPageMap?.strategy === "dom" ? payload.documentPageMap : undefined;
    const documentPageMap = discoveryRan ? discoveredPageMap : legacyDomPageMap;
    const extent = pageMapExtent(documentPageMap);
    const scrollWidth = Math.max(payload.scrollWidth, extent.right);
    const scrollHeight = Math.max(payload.scrollHeight, extent.bottom);
    const discoveredWidthDrift = extent.right > payload.scrollWidth + 2;
    return {
      requestedScrollLeft: payload.requestedScrollLeft,
      requestedScrollTop: payload.requestedScrollTop,
      actualScrollLeft: payload.actualScrollLeft,
      actualScrollTop: payload.actualScrollTop,
      scrollWidth,
      scrollHeight,
      clientWidth: payload.clientWidth,
      clientHeight: payload.clientHeight,
      viewportWidth: payload.viewportWidth,
      viewportHeight: payload.viewportHeight,
      devicePixelRatio: payload.devicePixelRatio,
      captureCropCss: payload.captureCropCss,
      hiddenStickyElements: payload.hiddenStickyElements,
      stableSamples: payload.stableSamples,
      mutationCount: payload.mutationCount,
      scrollSnapped: payload.scrollSnapped,
      layoutChanged: payload.layoutChanged || discoveredWidthDrift,
      ...(documentPageMap === undefined ? {} : { documentPageMap }),
    };
  }

  async cleanup(
    tabId: number,
    jobId: string,
    descriptor: ElementTargetDescriptor,
  ): Promise<ScrollAreaCleanupResult> {
    await this.browser.injectContentScript(tabId);
    const requestId = this.requestId();
    const response = await this.browser.sendMessage(
      tabId,
      createScrollAreaCleanupMessage({
        requestId,
        sentAt: this.now().toISOString(),
        jobId,
        descriptor,
      }),
    );
    const parsed = parseScrollAreaCleanupResponse(response, requestId);
    if (!parsed.ok) throw createWebCapRuntimeError(parsed.error);
    return {
      restoredElements: parsed.value.payload.restoredElements,
      skippedElements: parsed.value.payload.skippedElements,
      scrollRestored: parsed.value.payload.scrollRestored,
      documentScrollRestored: parsed.value.payload.documentScrollRestored,
    };
  }
}
