import type {
  PdfViewerAdapterKind,
  PdfViewerDiscoverySnapshot,
  PdfViewerPageCandidate,
} from "@shared/contracts/pdf-viewer-discovery";
import type { Rect } from "@shared/contracts/domain";

const PAGE_SELECTOR = [
  ".page[data-page-number]",
  "[data-page-number]",
  "[data-page-index]",
  ".pageContainer",
  ".page-container",
  ".pdf-page",
  "viewer-pdf-page",
  "pdf-viewer-page",
].join(",");
const ROOT_SCAN_LIMIT = 20_000;
const MAX_SAMPLES = 10_000;

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
}

function collectRoots(target: HTMLElement): Array<Element | ShadowRoot> {
  const roots: Array<Element | ShadowRoot> = [target];
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
  const attributes = ["data-page-count", "data-pages-count", "page-count", "aria-setsize"];
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

function pdfContextSignal(target: HTMLElement): boolean {
  if (document.contentType.toLowerCase().includes("pdf")) return true;
  if (/\.pdf(?:$|[?#])/iu.test(globalThis.location.href)) return true;
  const hint = [target.tagName, ...target.classList].join(" ");
  if (/(pdf|document|viewer)/iu.test(hint)) return true;
  for (const root of collectRoots(target)) {
    if (
      root.querySelector(
        'embed[type="application/pdf"], object[type="application/pdf"], source[type="application/pdf"]',
      ) !== null
    ) {
      return true;
    }
  }
  return false;
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

export async function discoverPdfViewerSnapshot(
  target: HTMLElement,
  settleMs: number,
): Promise<PdfViewerDiscoverySnapshot> {
  const originalLeft = target.scrollLeft;
  const originalTop = target.scrollTop;
  const candidates: PdfViewerPageCandidate[] = [];
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

  const sample = () => {
    const roots = collectRoots(target);
    const selected = new Set<Element>();
    let sawShadow = false;
    for (const root of roots) {
      if (root instanceof ShadowRoot) sawShadow = true;
      if (root instanceof Element && root !== target && root.matches(PAGE_SELECTOR)) selected.add(root);
      for (const element of Array.from(root.querySelectorAll(PAGE_SELECTOR))) selected.add(element);
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
    }
    if (selected.size === 0 && ((observedPageCount ?? 0) > 0 || pdfContextSignal(target))) {
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
    const confidence = adapterConfidence(sampleAdapter);
    for (const element of selected) {
      const rect = rectInsideTarget(target, element);
      if (rect === undefined) continue;
      const declaredIndex = pageIndex(element);
      candidates.push({
        rect,
        adapter: sampleAdapter,
        confidence: declaredIndex === undefined ? Math.max(0, confidence - 0.04) : confidence,
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
    let nextTop = 0;
    while (sampleIndex < MAX_SAMPLES) {
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
