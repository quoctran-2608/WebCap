import type { DocumentPageMap, ElementTargetDescriptor, Rect } from "@shared/contracts/domain";
import {
  createPdfViewerDiscoveryRequest,
  parsePdfViewerDiscoveryResponse,
  type PdfViewerAdapterKind,
  type PdfViewerDiscoverySnapshot,
  type PdfViewerPageCandidate,
} from "@shared/contracts/pdf-viewer-discovery";
import { createWebCapRuntimeError } from "@shared/errors/error";

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

export type { PdfViewerAdapterKind, PdfViewerDiscoverySnapshot, PdfViewerPageCandidate };

export interface PdfViewerDiscoveryPort {
  discover(options: {
    tabId: number;
    jobId: string;
    descriptor: ElementTargetDescriptor;
    settleMs: number;
  }): Promise<DocumentPageMap | undefined>;
}

export interface PdfViewerDiscoveryBrowserAdapter {
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

const PAGE_EDGE_MIN_CSS = 96;
const PAGE_OVERLAP_RATIO = 0.78;
const STABLE_GEOMETRY_OVERLAP_RATIO = 0.92;
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

function hasStableCanvasGeometry(candidates: readonly PdfViewerPageCandidate[]): boolean {
  if (!candidates.every((candidate) => candidate.adapter === "canvas-visual")) return true;

  const sampleCounts = new Map<number, number>();
  for (const candidate of candidates) {
    sampleCounts.set(candidate.sampleIndex, (sampleCounts.get(candidate.sampleIndex) ?? 0) + 1);
  }
  if (![...sampleCounts.values()].some((count) => count >= 2)) return false;

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex];
      if (right === undefined || left.sampleIndex === right.sampleIndex) continue;
      if (overlapRatio(left.rect, right.rect) >= STABLE_GEOMETRY_OVERLAP_RATIO) return true;
    }
  }
  return false;
}

function geometryCompletion(
  snapshot: PdfViewerDiscoverySnapshot,
  candidates: readonly PdfViewerPageCandidate[],
): DocumentPageMap | undefined {
  if (!snapshot.reachedStart || !snapshot.reachedEnd || snapshot.stableEndRounds < 2) {
    return undefined;
  }
  if (!hasStableCanvasGeometry(candidates)) return undefined;

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
  if (
    snapshot.declaredPageCount !== undefined &&
    deduplicated.length !== snapshot.declaredPageCount
  ) {
    return undefined;
  }

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

export class ChromePdfViewerDiscovery implements PdfViewerDiscoveryPort {
  constructor(
    private readonly browser: PdfViewerDiscoveryBrowserAdapter = {
      sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    },
    private readonly now: () => Date = () => new Date(),
    private readonly requestId: () => string = () => crypto.randomUUID(),
  ) {}

  async discover(options: {
    tabId: number;
    jobId: string;
    descriptor: ElementTargetDescriptor;
    settleMs: number;
  }): Promise<DocumentPageMap | undefined> {
    const requestId = this.requestId();
    const response = await this.browser.sendMessage(
      options.tabId,
      createPdfViewerDiscoveryRequest({
        requestId,
        sentAt: this.now().toISOString(),
        jobId: options.jobId,
        descriptor: options.descriptor,
        settleMs: options.settleMs,
      }),
    );
    const parsed = parsePdfViewerDiscoveryResponse(response, requestId);
    if (!parsed.ok) throw createWebCapRuntimeError(parsed.error);
    if (
      parsed.value.payload.jobId !== options.jobId ||
      parsed.value.payload.descriptor.selectionId !== options.descriptor.selectionId
    ) {
      throw new Error("PDF viewer discovery response did not match the selected target.");
    }
    return finalizePdfViewerDiscovery(parsed.value.payload.snapshot);
  }
}
