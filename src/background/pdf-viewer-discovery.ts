import type { DocumentPageMap, ElementTargetDescriptor, Rect } from "@shared/contracts/domain";

export type PdfViewerAdapterKind =
  | "pdfjs"
  | "generic-semantic"
  | "shadow-root"
  | "virtualized"
  | "canvas-visual";

export interface PdfViewerAdapter {
  readonly kind: PdfViewerAdapterKind;
  readonly baseConfidence: number;
  readonly semantic: boolean;
}

export const PDF_VIEWER_ADAPTERS: readonly PdfViewerAdapter[] = Object.freeze([
  { kind: "pdfjs", baseConfidence: 0.99, semantic: true },
  { kind: "generic-semantic", baseConfidence: 0.94, semantic: true },
  { kind: "shadow-root", baseConfidence: 0.92, semantic: true },
  { kind: "virtualized", baseConfidence: 0.9, semantic: true },
  { kind: "canvas-visual", baseConfidence: 0.76, semantic: false },
]);

export interface PdfViewerPageCandidate {
  rect: Rect;
  adapter: PdfViewerAdapterKind;
  confidence: number;
  sampleIndex: number;
  declaredIndex?: number;
}

export interface PdfViewerDiscoverySnapshot {
  adapter: PdfViewerAdapterKind;
  declaredPageCount?: number;
  scrollWidth: number;
  scrollHeight: number;
  clientHeight: number;
  reachedStart: boolean;
  reachedEnd: boolean;
  stableEndRounds: number;
  candidates: PdfViewerPageCandidate[];
}

export interface PdfViewerDiscoveryPort {
  discover(options: {
    tabId: number;
    descriptor: ElementTargetDescriptor;
    settleMs: number;
  }): Promise<DocumentPageMap | undefined>;
}

const PAGE_EDGE_MIN_CSS = 96;
const PAGE_OVERLAP_RATIO = 0.78;
const MAX_PAGES = 10_000;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle] ?? 0;
  if (ordered.length % 2 === 1) return upper;
  return ((ordered[middle - 1] ?? upper) + upper) / 2;
}

function overlapRatio(left: Rect, right: Rect): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const intersection = width * height;
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller <= 0 ? 0 : intersection / smaller;
}

function normalizeCandidate(
  candidate: PdfViewerPageCandidate,
  scrollWidth: number,
  scrollHeight: number,
): PdfViewerPageCandidate | undefined {
  const rect = candidate.rect;
  if (
    !finitePositive(rect.width) ||
    !finitePositive(rect.height) ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    rect.width < PAGE_EDGE_MIN_CSS ||
    rect.height < PAGE_EDGE_MIN_CSS
  ) {
    return undefined;
  }
  const left = Math.max(0, Math.min(scrollWidth, rect.x));
  const top = Math.max(0, Math.min(scrollHeight, rect.y));
  const right = Math.max(left, Math.min(scrollWidth, rect.x + rect.width));
  const bottom = Math.max(top, Math.min(scrollHeight, rect.y + rect.height));
  if (right - left < PAGE_EDGE_MIN_CSS || bottom - top < PAGE_EDGE_MIN_CSS) return undefined;
  const { declaredIndex, ...rest } = candidate;
  const validDeclaredIndex =
    declaredIndex !== undefined && Number.isInteger(declaredIndex) && declaredIndex >= 0;
  return {
    ...rest,
    rect: { x: left, y: top, width: right - left, height: bottom - top },
    confidence: Math.max(0, Math.min(1, candidate.confidence)),
    ...(validDeclaredIndex ? { declaredIndex } : {}),
  };
}

function preferCandidate(
  current: PdfViewerPageCandidate | undefined,
  candidate: PdfViewerPageCandidate,
): PdfViewerPageCandidate {
  if (current === undefined) return candidate;
  if (candidate.confidence !== current.confidence) {
    return candidate.confidence > current.confidence ? candidate : current;
  }
  const candidateArea = candidate.rect.width * candidate.rect.height;
  const currentArea = current.rect.width * current.rect.height;
  return candidateArea > currentArea ? candidate : current;
}

function confidenceFor(candidates: readonly PdfViewerPageCandidate[]): number {
  if (candidates.length === 0) return 0;
  const average =
    candidates.reduce((total, candidate) => total + candidate.confidence, 0) / candidates.length;
  return Math.max(0, Math.min(1, average));
}

function declaredCompletion(
  snapshot: PdfViewerDiscoverySnapshot,
  candidates: readonly PdfViewerPageCandidate[],
): DocumentPageMap | undefined {
  const count = snapshot.declaredPageCount;
  if (
    count === undefined ||
    count <= 0 ||
    count > MAX_PAGES ||
    !snapshot.reachedStart ||
    !snapshot.reachedEnd ||
    snapshot.stableEndRounds < 2
  ) {
    return undefined;
  }

  const byIndex = new Map<number, PdfViewerPageCandidate>();
  for (const candidate of candidates) {
    const index = candidate.declaredIndex;
    if (index === undefined || index >= count) continue;
    byIndex.set(index, preferCandidate(byIndex.get(index), candidate));
  }
  if (byIndex.size !== count) return undefined;

  const ordered = Array.from({ length: count }, (_, index) => byIndex.get(index));
  if (ordered.some((candidate) => candidate === undefined)) return undefined;
  const evidence = ordered.filter(
    (candidate): candidate is PdfViewerPageCandidate => candidate !== undefined,
  );
  return {
    schemaVersion: 1,
    strategy: "dom",
    confidence: Math.max(0.9, confidenceFor(evidence)),
    complete: true,
    sourcePageCount: count,
    pages: evidence.map((candidate, index) => ({
      index,
      sourceRectCss: candidate.rect,
    })),
  };
}

function geometryCompletion(
  snapshot: PdfViewerDiscoverySnapshot,
  candidates: readonly PdfViewerPageCandidate[],
): DocumentPageMap | undefined {
  if (!snapshot.reachedStart || !snapshot.reachedEnd || snapshot.stableEndRounds < 2) {
    return undefined;
  }

  const ordered = [...candidates].sort(
    (left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x,
  );
  const deduplicated: PdfViewerPageCandidate[] = [];
  for (const candidate of ordered) {
    const matchIndex = deduplicated.findIndex(
      (existing) => overlapRatio(existing.rect, candidate.rect) >= PAGE_OVERLAP_RATIO,
    );
    if (matchIndex < 0) {
      deduplicated.push(candidate);
      continue;
    }
    deduplicated[matchIndex] = preferCandidate(deduplicated[matchIndex], candidate);
  }
  deduplicated.sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x);
  if (deduplicated.length < 2 || deduplicated.length > MAX_PAGES) return undefined;

  const heights = deduplicated.map((candidate) => candidate.rect.height);
  const medianHeight = median(heights);
  const edgeTolerance = Math.max(96, medianHeight * 0.16);
  const first = deduplicated[0]?.rect;
  const last = deduplicated.at(-1)?.rect;
  if (
    first === undefined ||
    last === undefined ||
    first.y > edgeTolerance ||
    last.y + last.height < snapshot.scrollHeight - edgeTolerance
  ) {
    return undefined;
  }

  const gapLimit = Math.max(180, medianHeight * 0.55);
  for (let index = 1; index < deduplicated.length; index += 1) {
    const previous = deduplicated[index - 1]?.rect;
    const current = deduplicated[index]?.rect;
    if (previous === undefined || current === undefined) return undefined;
    const gap = current.y - (previous.y + previous.height);
    if (gap > gapLimit) return undefined;
  }

  const confidence = confidenceFor(deduplicated);
  if (confidence < 0.72) return undefined;
  return {
    schemaVersion: 1,
    strategy: "dom",
    confidence: Math.min(0.97, Math.max(0.82, confidence)),
    complete: true,
    sourcePageCount: deduplicated.length,
    pages: deduplicated.map((candidate, index) => ({
      index,
      sourceRectCss: candidate.rect,
    })),
  };
}

export function finalizePdfViewerDiscovery(
  snapshot: PdfViewerDiscoverySnapshot,
): DocumentPageMap | undefined {
  if (
    !finitePositive(snapshot.scrollWidth) ||
    !finitePositive(snapshot.scrollHeight) ||
    !finitePositive(snapshot.clientHeight)
  ) {
    return undefined;
  }
  const candidates = snapshot.candidates
    .map((candidate) => normalizeCandidate(candidate, snapshot.scrollWidth, snapshot.scrollHeight))
    .filter((candidate): candidate is PdfViewerPageCandidate => candidate !== undefined);
  if (candidates.length === 0) return undefined;
  return declaredCompletion(snapshot, candidates) ?? geometryCompletion(snapshot, candidates);
}

async function discoverPdfViewerInContent(
  selectionId: string,
  settleMs: number,
): Promise<PdfViewerDiscoverySnapshot | undefined> {
  interface StoredTarget {
    element: Element;
  }
  interface ElementRuntimeState {
    targets?: Map<string, StoredTarget>;
  }
  interface StateCarrier {
    __webcapElementSelectionV1__?: ElementRuntimeState;
  }

  const runtime = (globalThis as typeof globalThis & StateCarrier).__webcapElementSelectionV1__;
  const stored = runtime?.targets?.get(selectionId);
  if (stored === undefined || !(stored.element instanceof HTMLElement) || !stored.element.isConnected) {
    return undefined;
  }
  const target = stored.element;
  const originalLeft = target.scrollLeft;
  const originalTop = target.scrollTop;
  const candidates: PdfViewerPageCandidate[] = [];
  let declaredPageCount = 0;
  let sampleIndex = 0;
  let stableEndRounds = 0;
  let lastHeight = Math.max(1, target.scrollHeight);
  let adapter: PdfViewerAdapterKind = "generic-semantic";

  const frame = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  const frames = async () => {
    await frame();
    await frame();
  };
  const delay = (milliseconds: number) =>
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, Math.max(0, milliseconds));
    });
  const positiveAttribute = (element: Element, names: readonly string[]): number | undefined => {
    for (const name of names) {
      const raw = element.getAttribute(name);
      if (raw === null) continue;
      const parsed = Number.parseInt(raw, 10);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
    return undefined;
  };
  const pageIndex = (element: Element): number | undefined => {
    const direct = element.getAttribute("data-page-index") ?? element.getAttribute("page-index");
    if (direct !== null) {
      const parsed = Number.parseInt(direct, 10);
      if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    }
    const numbered = positiveAttribute(element, ["data-page-number", "page-number"]);
    if (numbered !== undefined) return numbered - 1;
    const label = element.getAttribute("aria-label") ?? "";
    const match = /(?:page|trang)\s*(\d+)/iu.exec(label)?.[1];
    if (match === undefined) return undefined;
    const parsed = Number.parseInt(match, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : undefined;
  };
  const rectInsideTarget = (element: Element): Rect | undefined => {
    const targetRect = target.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (rect.width < 96 || rect.height < 96) return undefined;
    const absolute: Rect = {
      x: rect.left - targetRect.left - target.clientLeft + target.scrollLeft,
      y: rect.top - targetRect.top - target.clientTop + target.scrollTop,
      width: rect.width,
      height: rect.height,
    };
    if (
      absolute.x + absolute.width < 0 ||
      absolute.y + absolute.height < 0 ||
      absolute.x > target.scrollWidth ||
      absolute.y > target.scrollHeight
    ) {
      return undefined;
    }
    return absolute;
  };
  const collectRoots = (): Array<Element | ShadowRoot> => {
    const roots: Array<Element | ShadowRoot> = [target];
    let cursor = 0;
    let scanned = 0;
    while (cursor < roots.length && scanned < 20_000) {
      const root = roots[cursor];
      cursor += 1;
      if (root === undefined) break;
      for (const element of Array.from(root.querySelectorAll("*"))) {
        scanned += 1;
        if (scanned >= 20_000) break;
        if (element.shadowRoot?.mode === "open") roots.push(element.shadowRoot);
      }
    }
    return roots;
  };
  const inspectPageCount = (elements: readonly Element[]) => {
    const attributes = ["data-page-count", "data-pages-count", "page-count", "aria-setsize"];
    const inspect = (element: Element | null) => {
      if (element === null) return;
      declaredPageCount = Math.max(declaredPageCount, positiveAttribute(element, attributes) ?? 0);
    };
    inspect(target);
    for (const element of elements) inspect(element);
    let ancestor: Element | null = target;
    for (let depth = 0; depth < 8 && ancestor !== null; depth += 1) {
      inspect(ancestor);
      const root = ancestor.getRootNode();
      ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
  };
  const pdfContextSignal = (): boolean => {
    if (document.contentType.toLowerCase().includes("pdf")) return true;
    if (/\.pdf(?:$|[?#])/iu.test(globalThis.location.href)) return true;
    for (const root of collectRoots()) {
      if (
        root.querySelector(
          'embed[type="application/pdf"], object[type="application/pdf"], source[type="application/pdf"]',
        ) !== null
      ) {
        return true;
      }
    }
    return false;
  };
  const sample = () => {
    const selectors = [
      ".page[data-page-number]",
      "[data-page-number]",
      "[data-page-index]",
      ".pageContainer",
      ".page-container",
      ".pdf-page",
      "viewer-pdf-page",
      "pdf-viewer-page",
    ].join(",");
    const roots = collectRoots();
    const selected = new Set<Element>();
    let sawShadow = false;
    for (const root of roots) {
      if (root instanceof ShadowRoot) sawShadow = true;
      if (root instanceof Element && root !== target && root.matches(selectors)) selected.add(root);
      for (const element of Array.from(root.querySelectorAll(selectors))) selected.add(element);
    }

    inspectPageCount([...selected]);
    let sampleAdapter: PdfViewerAdapterKind = "generic-semantic";
    if ([...selected].some((element) => element.matches(".page[data-page-number]"))) {
      sampleAdapter = "pdfjs";
    } else if (sawShadow && selected.size > 0) {
      sampleAdapter = "shadow-root";
    }
    if (selected.size === 0) {
      inspectPageCount([]);
      if (declaredPageCount > 0 || pdfContextSignal()) {
        for (const root of roots) {
          for (const canvas of Array.from(root.querySelectorAll("canvas"))) selected.add(canvas);
        }
      }
      if (selected.size > 0) sampleAdapter = "canvas-visual";
    }

    if (declaredPageCount > selected.size && selected.size > 0 && sampleAdapter !== "canvas-visual") {
      sampleAdapter = "virtualized";
    }
    adapter = sampleAdapter;
    const baseConfidence =
      sampleAdapter === "pdfjs"
        ? 0.99
        : sampleAdapter === "shadow-root"
          ? 0.92
          : sampleAdapter === "virtualized"
            ? 0.9
            : sampleAdapter === "canvas-visual"
              ? 0.76
              : 0.94;
    for (const element of selected) {
      const rect = rectInsideTarget(element);
      if (rect === undefined) continue;
      const declaredIndex = pageIndex(element);
      candidates.push({
        rect,
        adapter: sampleAdapter,
        confidence: declaredIndex === undefined ? baseConfidence - 0.04 : baseConfidence,
        sampleIndex,
        ...(declaredIndex === undefined ? {} : { declaredIndex }),
      });
    }
    sampleIndex += 1;
  };

  try {
    target.scrollLeft = 0;
    target.scrollTop = 0;
    await frames();
    sample();
    const boundedSettleMs = Math.min(250, Math.max(0, Math.round(settleMs)));
    const step = Math.max(128, Math.round(Math.max(1, target.clientHeight) * 0.8));
    const maxSamples = 10_000;
    let nextTop = 0;
    while (sampleIndex < maxSamples) {
      const height = Math.max(1, target.scrollHeight);
      const maxTop = Math.max(0, height - Math.max(1, target.clientHeight));
      nextTop = Math.min(maxTop, nextTop + step);
      target.scrollTop = nextTop;
      await frames();
      if (boundedSettleMs > 0) await delay(boundedSettleMs);
      await frames();
      sample();

      const currentHeight = Math.max(1, target.scrollHeight);
      const currentMaxTop = Math.max(0, currentHeight - Math.max(1, target.clientHeight));
      const atEnd = target.scrollTop >= currentMaxTop - 1;
      if (atEnd && Math.abs(currentHeight - lastHeight) <= 1) stableEndRounds += 1;
      else stableEndRounds = 0;
      lastHeight = currentHeight;
      if (atEnd && stableEndRounds >= 3) break;
      if (nextTop >= currentMaxTop - 1 && !atEnd) nextTop = target.scrollTop;
    }

    const reachedEnd = stableEndRounds >= 2;
    return {
      adapter,
      ...(declaredPageCount > 0 ? { declaredPageCount } : {}),
      scrollWidth: Math.max(1, target.scrollWidth),
      scrollHeight: Math.max(1, target.scrollHeight),
      clientHeight: Math.max(1, target.clientHeight),
      reachedStart: true,
      reachedEnd,
      stableEndRounds,
      candidates,
    };
  } finally {
    target.scrollLeft = originalLeft;
    target.scrollTop = originalTop;
    await frames().catch(() => undefined);
  }
}

export class ChromePdfViewerDiscovery implements PdfViewerDiscoveryPort {
  async discover(options: {
    tabId: number;
    descriptor: ElementTargetDescriptor;
    settleMs: number;
  }): Promise<DocumentPageMap | undefined> {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: options.tabId },
        func: discoverPdfViewerInContent,
        args: [options.descriptor.selectionId, options.settleMs],
      });
      const snapshot = results[0]?.result;
      return snapshot === undefined ? undefined : finalizePdfViewerDiscovery(snapshot);
    } catch {
      return undefined;
    }
  }
}
