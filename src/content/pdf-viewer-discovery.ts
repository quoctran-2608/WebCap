import type {
  PdfViewerAdapterKind,
  PdfViewerDiscoverySnapshot,
  PdfViewerPageCandidate,
  PdfViewerRenderState,
} from "@shared/contracts/pdf-viewer-discovery";
import type { Rect } from "@shared/contracts/domain";

const PAGE_SELECTOR = [
  ".page[data-page-number]",
  "[data-page-number]",
  "[data-page-index]",
  "[data-page]",
  "[data-page-id]",
  ".pageContainer",
  ".page-container",
  ".page-wrapper",
  ".page-view",
  ".viewer-page",
  ".pdf-page",
  ".pf",
  '[role="document"]',
  '[role="group"][aria-label*="page" i]',
  '[role="group"][aria-label*="trang" i]',
  "viewer-pdf-page",
  "pdf-viewer-page",
].join(",");
const ROOT_SCAN_LIMIT = 20_000;
const MAX_SAMPLES = 10_000;
const MAX_INTERMEDIATE_SETTLE_MS = 80;
const MAX_TERMINAL_SETTLE_MS = 250;
const MAX_GEOMETRY_OBSERVATIONS = 2;
const GENERIC_SCAN_DEPTH = 6;
const GENERIC_CHILD_LIMIT = 96;

function positiveAttribute(element: Element, names: readonly string[]): number | undefined {
  for (const name of names) {
    const raw = element.getAttribute(name);
    if (raw === null) continue;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function pageIndex(element: Element): number | undefined {
  const direct =
    element.getAttribute("data-page-index") ??
    element.getAttribute("page-index") ??
    element.getAttribute("data-index");
  if (direct !== null) {
    const parsed = Number.parseInt(direct, 10);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  const numbered = positiveAttribute(element, [
    "data-page-number",
    "page-number",
    "data-page",
    "data-page-id",
  ]);
  if (numbered !== undefined) return numbered - 1;
  const label = element.getAttribute("aria-label") ?? "";
  const match = /(?:page|trang)\s*(\d+)/iu.exec(label)?.[1];
  if (match === undefined) return undefined;
  const parsed = Number.parseInt(match, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : undefined;
}

function collectRoots(target: HTMLElement): Array<Element | ShadowRoot> {
  const roots: Array<Element | ShadowRoot> = [target];
  if (target.shadowRoot?.mode === "open") roots.push(target.shadowRoot);
  let cursor = 0;
  let scanned = 0;
  while (cursor < roots.length && scanned < ROOT_SCAN_LIMIT) {
    const root = roots[cursor];
    cursor += 1;
    if (root === undefined) break;
    for (const element of Array.from(root.querySelectorAll("*"))) {
      scanned += 1;
      if (scanned >= ROOT_SCAN_LIMIT) break;
      if (element.shadowRoot?.mode === "open") roots.push(element.shadowRoot);
    }
  }
  return roots;
}

function rectInsideTarget(target: HTMLElement, element: Element): Rect | undefined {
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
}

function declaredPageCount(target: HTMLElement, elements: readonly Element[]): number | undefined {
  let count = 0;
  const attributes = [
    "data-page-count",
    "data-pages-count",
    "data-total-pages",
    "data-page-total",
    "page-count",
    "total-pages",
    "aria-setsize",
    "aria-rowcount",
  ];
  const inspect = (element: Element | null) => {
    if (element === null) return;
    count = Math.max(count, positiveAttribute(element, attributes) ?? 0);
  };
  inspect(target);
  for (const element of elements) inspect(element);
  let ancestor: Element | null = target;
  for (let depth = 0; depth < 8 && ancestor !== null; depth += 1) {
    inspect(ancestor);
    const root = ancestor.getRootNode();
    ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return count > 0 ? count : undefined;
}

function normalizedStateValue(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function canvasHasDurableSurface(canvas: HTMLCanvasElement): boolean {
  return canvas.width > 0 && canvas.height > 0;
}

function pageRenderState(element: Element): PdfViewerRenderState {
  const loaded = normalizedStateValue(element.getAttribute("data-loaded"));
  const rendered = normalizedStateValue(element.getAttribute("data-rendered"));
  const rendering = normalizedStateValue(
    element.getAttribute("data-rendering-state") ?? element.getAttribute("rendering-state"),
  );
  if (
    loaded === "false" ||
    rendered === "false" ||
    ["initial", "loading", "pending", "running", "rendering"].includes(rendering) ||
    normalizedStateValue(element.getAttribute("aria-busy")) === "true" ||
    element.matches("[data-placeholder='true'], .placeholder, .skeleton") ||
    element.querySelector(
      "[data-placeholder='true'], [data-loaded='false'], [data-rendered='false'], [aria-busy='true']",
    ) !== null
  ) {
    return "placeholder";
  }

  if (
    loaded === "true" ||
    rendered === "true" ||
    ["finished", "ready", "rendered", "complete"].includes(rendering)
  ) {
    return "ready";
  }

  if (element instanceof HTMLCanvasElement) {
    return canvasHasDurableSurface(element) ? "ready" : "placeholder";
  }
  const canvas = element.querySelector("canvas");
  if (canvas instanceof HTMLCanvasElement && canvasHasDurableSurface(canvas)) return "ready";
  const image = element.querySelector("img");
  if (
    image instanceof HTMLImageElement &&
    image.complete &&
    image.naturalWidth > 0 &&
    image.naturalHeight > 0
  ) {
    return "ready";
  }
  if (element.querySelector("svg") !== null) return "ready";
  return "unknown";
}

function pageSemanticSignal(element: Element): boolean {
  const hint = [
    element.tagName,
    element.id,
    ...element.classList,
    element.getAttribute("role") ?? "",
    element.getAttribute("aria-label") ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (/(?:page|trang|sheet|paper|pdf|document)/u.test(hint)) return true;
  return [
    "data-page-number",
    "data-page-index",
    "data-page",
    "data-page-id",
    "page-number",
    "page-index",
  ].some((name) => element.hasAttribute(name));
}

function isTransparentColor(value: string): boolean {
  const normalized = value.replaceAll(" ", "").toLowerCase();
  return normalized === "transparent" || normalized === "rgba(0,0,0,0)";
}

function paperSurfaceSignal(element: Element): boolean {
  if (pageSemanticSignal(element)) return true;
  const style = getComputedStyle(element);
  if (style.boxShadow !== "none") return true;
  const borderWidth =
    Number.parseFloat(style.borderTopWidth) +
    Number.parseFloat(style.borderRightWidth) +
    Number.parseFloat(style.borderBottomWidth) +
    Number.parseFloat(style.borderLeftWidth);
  if (Number.isFinite(borderWidth) && borderWidth > 0) return true;
  if (isTransparentColor(style.backgroundColor)) return false;
  const parent = element.parentElement;
  if (parent === null) return true;
  return style.backgroundColor !== getComputedStyle(parent).backgroundColor;
}

function genericPageRect(target: HTMLElement, element: Element): Rect | undefined {
  const rect = rectInsideTarget(target, element);
  if (rect === undefined) return undefined;
  const minWidth = Math.max(160, target.clientWidth * 0.5);
  const minHeight = Math.max(180, target.clientHeight * 0.5);
  if (rect.width < minWidth || rect.height < minHeight) return undefined;
  const aspect = rect.width / rect.height;
  if (aspect < 0.35 || aspect > 2.2) return undefined;
  if (rect.width >= target.scrollWidth * 0.94 && rect.height >= target.scrollHeight * 0.72) {
    return undefined;
  }
  return rect;
}

function dimensionsSimilar(left: Rect, right: Rect): boolean {
  const widthRatio =
    Math.max(left.width, right.width) / Math.max(1, Math.min(left.width, right.width));
  const heightRatio =
    Math.max(left.height, right.height) / Math.max(1, Math.min(left.height, right.height));
  return widthRatio <= 1.35 && heightRatio <= 1.35;
}

function directChildren(element: Element): Element[] {
  const children = Array.from(element.children);
  if (element.shadowRoot?.mode === "open") {
    children.push(...Array.from(element.shadowRoot.children));
  }
  return children.slice(0, GENERIC_CHILD_LIMIT);
}

function collectRepeatedPageBlocks(target: HTMLElement): Element[] {
  const selected = new Set<Element>();
  let frontier: Element[] = [target];
  const seen = new Set<Element>();

  for (let depth = 0; depth < GENERIC_SCAN_DEPTH && frontier.length > 0; depth += 1) {
    const next: Element[] = [];
    for (const parent of frontier) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      const children = directChildren(parent);
      const pageSized = children
        .map((element) => ({ element, rect: genericPageRect(target, element) }))
        .filter(
          (candidate): candidate is { element: Element; rect: Rect } =>
            candidate.rect !== undefined,
        );

      for (const candidate of pageSized) {
        const repeated =
          pageSized.filter((other) => dimensionsSimilar(candidate.rect, other.rect)).length >= 2;
        if (repeated || paperSurfaceSignal(candidate.element)) selected.add(candidate.element);
      }

      for (const child of children) {
        if (seen.has(child)) continue;
        const rect = rectInsideTarget(target, child);
        const largeContainer =
          rect !== undefined &&
          rect.width >= Math.max(120, target.clientWidth * 0.4) &&
          (rect.height >= Math.max(160, target.clientHeight * 0.4) ||
            (child instanceof HTMLElement && child.scrollHeight > target.clientHeight * 1.4));
        if (largeContainer || child.shadowRoot?.mode === "open") next.push(child);
      }
    }
    frontier = next.slice(0, ROOT_SCAN_LIMIT);
  }

  return [...selected];
}

function adapterConfidence(adapter: PdfViewerAdapterKind): number {
  switch (adapter) {
    case "pdfjs":
      return 0.99;
    case "shadow-root":
      return 0.92;
    case "virtualized":
      return 0.9;
    case "canvas-visual":
      return 0.76;
    default:
      return 0.94;
  }
}

function renderStateRank(state: PdfViewerRenderState | undefined): number {
  switch (state) {
    case "ready":
      return 2;
    case "unknown":
    case undefined:
      return 1;
    case "placeholder":
      return 0;
  }
}

function preferCandidate(
  current: PdfViewerPageCandidate | undefined,
  candidate: PdfViewerPageCandidate,
): PdfViewerPageCandidate {
  if (current === undefined) return candidate;
  const candidateState = renderStateRank(candidate.renderState);
  const currentState = renderStateRank(current.renderState);
  if (candidateState !== currentState) return candidateState > currentState ? candidate : current;
  if (candidate.confidence !== current.confidence) {
    return candidate.confidence > current.confidence ? candidate : current;
  }
  const candidateArea = candidate.rect.width * candidate.rect.height;
  const currentArea = current.rect.width * current.rect.height;
  return candidateArea > currentArea ? candidate : current;
}

function geometryKey(candidate: PdfViewerPageCandidate): string {
  const quantize = (value: number) => Math.round(value * 2);
  const rect = candidate.rect;
  return [
    candidate.adapter,
    quantize(rect.x),
    quantize(rect.y),
    quantize(rect.width),
    quantize(rect.height),
  ].join(":");
}

export async function discoverPdfViewerSnapshot(
  target: HTMLElement,
  settleMs: number,
): Promise<PdfViewerDiscoverySnapshot> {
  const originalLeft = target.scrollLeft;
  const originalTop = target.scrollTop;
  const declaredCandidates = new Map<number, PdfViewerPageCandidate>();
  const geometryCandidates = new Map<string, PdfViewerPageCandidate[]>();
  let observedPageCount: number | undefined;
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

  const rememberCandidate = (candidate: PdfViewerPageCandidate) => {
    const declaredIndex = candidate.declaredIndex;
    if (declaredIndex !== undefined) {
      declaredCandidates.set(
        declaredIndex,
        preferCandidate(declaredCandidates.get(declaredIndex), candidate),
      );
      return;
    }

    const key = geometryKey(candidate);
    const observations = geometryCandidates.get(key) ?? [];
    if (observations.some((observation) => observation.sampleIndex === candidate.sampleIndex)) {
      return;
    }
    if (observations.length < MAX_GEOMETRY_OBSERVATIONS) {
      observations.push(candidate);
      geometryCandidates.set(key, observations);
    }
  };

  const sample = () => {
    const roots = collectRoots(target);
    const selected = new Set<Element>();
    let sawShadow = false;
    for (const root of roots) {
      if (root instanceof ShadowRoot) sawShadow = true;
      if (root instanceof Element && root !== target && root.matches(PAGE_SELECTOR)) {
        selected.add(root);
      }
      for (const element of Array.from(root.querySelectorAll(PAGE_SELECTOR))) selected.add(element);
    }

    let usedGenericHeuristic = false;
    if (selected.size === 0) {
      for (const element of collectRepeatedPageBlocks(target)) selected.add(element);
      usedGenericHeuristic = selected.size > 0;
    }

    observedPageCount = Math.max(
      observedPageCount ?? 0,
      declaredPageCount(target, [...selected]) ?? 0,
    );

    let sampleAdapter: PdfViewerAdapterKind = "generic-semantic";
    if ([...selected].some((element) => element.matches(".page[data-page-number]"))) {
      sampleAdapter = "pdfjs";
    } else if (sawShadow && selected.size > 0) {
      sampleAdapter = "shadow-root";
    } else if (usedGenericHeuristic) {
      sampleAdapter = "virtualized";
    }

    if (selected.size === 0) {
      for (const root of roots) {
        for (const canvas of Array.from(root.querySelectorAll("canvas"))) selected.add(canvas);
      }
      if (selected.size > 0) sampleAdapter = "canvas-visual";
    }

    if (
      (observedPageCount ?? 0) > selected.size &&
      selected.size > 0 &&
      sampleAdapter !== "canvas-visual"
    ) {
      sampleAdapter = "virtualized";
    }
    adapter = sampleAdapter;
    const baseConfidence = adapterConfidence(sampleAdapter);
    const confidence = usedGenericHeuristic ? Math.min(baseConfidence, 0.86) : baseConfidence;
    for (const element of selected) {
      const rect = rectInsideTarget(target, element);
      if (rect === undefined) continue;
      const declaredIndex = pageIndex(element);
      const renderState = pageRenderState(element);
      rememberCandidate({
        rect,
        adapter: sampleAdapter,
        confidence: declaredIndex === undefined ? Math.max(0, confidence - 0.04) : confidence,
        sampleIndex,
        renderState,
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
    const requestedSettleMs = Math.min(MAX_TERMINAL_SETTLE_MS, Math.max(0, Math.round(settleMs)));
    const intermediateSettleMs = Math.min(MAX_INTERMEDIATE_SETTLE_MS, requestedSettleMs);
    const step = Math.max(128, Math.round(Math.max(1, target.clientHeight) * 0.8));
    let nextTop = 0;
    while (sampleIndex < MAX_SAMPLES) {
      const height = Math.max(1, target.scrollHeight);
      const maxTop = Math.max(0, height - Math.max(1, target.clientHeight));
      nextTop = Math.min(maxTop, nextTop + step);
      target.scrollTop = nextTop;
      await frames();

      const provisionalHeight = Math.max(1, target.scrollHeight);
      const provisionalMaxTop = Math.max(0, provisionalHeight - Math.max(1, target.clientHeight));
      const nearTerminal = target.scrollTop >= provisionalMaxTop - 1;
      const currentSettleMs = nearTerminal ? requestedSettleMs : intermediateSettleMs;
      if (currentSettleMs > 0) await delay(currentSettleMs);
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

    const candidates = [
      ...declaredCandidates.values(),
      ...Array.from(geometryCandidates.values()).flat(),
    ];
    return {
      adapter,
      ...((observedPageCount ?? 0) > 0 ? { declaredPageCount: observedPageCount } : {}),
      scrollWidth: Math.max(1, target.scrollWidth),
      scrollHeight: Math.max(1, target.scrollHeight),
      clientHeight: Math.max(1, target.clientHeight),
      reachedStart: true,
      reachedEnd: stableEndRounds >= 2,
      stableEndRounds,
      candidates,
    };
  } finally {
    target.scrollLeft = originalLeft;
    target.scrollTop = originalTop;
    await frames().catch(() => undefined);
  }
}
