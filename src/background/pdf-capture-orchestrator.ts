import type { CaptureJob, CaptureTile, Rect } from "@shared/contracts/domain";
import {
  PdfCompletionEvidenceSchema,
  PdfDocumentManifestSchema,
  PdfStrategyDecisionSchema,
  type PdfCompletionEvidence,
  type PdfDocumentManifest,
  type PdfOutputPlan,
  type PdfPageManifest,
  type PdfStrategyDecision,
} from "@shared/contracts/pdf-capture";
import type { PdfSourceCapability } from "@shared/contracts/pdf-source";
import {
  createWebCapError,
  createWebCapRuntimeError,
  type WebCapErrorData,
} from "@shared/errors/error";
import type { PdfDocumentManifestRepositoryPort } from "@storage/pdf-document-manifest-repository";

import {
  derivePdfPageProgress,
  transitionPdfManifest,
  updatePdfManifest,
} from "./pdf-state-machine";

const PAGE_COVERAGE_EPSILON_CSS = 0.05;
const DEFAULT_MANIFEST_TTL_MS = 30 * 60 * 1_000;

export interface PdfCaptureOrchestratorPort {
  prepareViewerExport(job: CaptureJob, outputPlan?: PdfOutputPlan): Promise<PdfDocumentManifest>;
  recordOutputProgress(
    jobId: string,
    completedPages: number,
    totalPages: number,
  ): Promise<PdfDocumentManifest | undefined>;
  completeViewerOutput(job: CaptureJob, outputPageCount: number): Promise<PdfCompletionEvidence>;
  recordPause?(jobId: string, error: WebCapErrorData): Promise<void>;
  recordFailure(jobId: string, error: WebCapErrorData): Promise<void>;
  getManifest(jobId: string): Promise<PdfDocumentManifest | undefined>;
}

export interface PdfCaptureOrchestratorOptions {
  manifests: PdfDocumentManifestRepositoryPort;
  now?: () => Date;
  manifestTtlMs?: number;
}

function pdfError(
  message: string,
  causeCode: string,
  safeContext: Record<string, string | number | boolean>,
): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message,
      userMessageKey: "errors.exportFailed",
      retryable: true,
      fallbackAllowed: false,
      causeCode,
      safeContext,
    }),
  );
}

function addMilliseconds(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

export function isDedicatedViewerPdfJob(job: CaptureJob): boolean {
  return (
    job.mode === "scroll-area" &&
    job.documentPageMap?.complete === true &&
    job.documentPageMap.pages.length === job.documentPageMap.sourcePageCount
  );
}

export function negotiatePdfCaptureStrategy(
  capability: PdfSourceCapability,
): PdfStrategyDecision | undefined {
  const sourcePermissionReady =
    capability.permission === "granted" || capability.permission === "not-required";
  if (
    capability.status === "original-passthrough" &&
    capability.canDownloadOriginal &&
    sourcePermissionReady
  ) {
    return PdfStrategyDecisionSchema.parse({
      schemaVersion: 1,
      primaryStrategy: "original-source",
      fallbackStrategies: capability.canCaptureViewer
        ? ["semantic-viewer", "visual-discovery"]
        : [],
      reason: "original-available",
      canDownloadOriginal: true,
      canCaptureViewer: capability.canCaptureViewer,
    });
  }

  if (capability.canCaptureViewer) {
    const reason =
      capability.status === "auth-required"
        ? "source-auth-required"
        : capability.permission === "host-required" ||
            capability.permission === "file-access-required"
          ? "source-permission-required"
          : capability.status === "viewer-capture"
            ? "source-unavailable"
            : "viewer-visible";
    return PdfStrategyDecisionSchema.parse({
      schemaVersion: 1,
      primaryStrategy: "semantic-viewer",
      fallbackStrategies: ["visual-discovery"],
      reason,
      canDownloadOriginal: capability.canDownloadOriginal,
      canCaptureViewer: true,
    });
  }

  if (capability.canDownloadOriginal) {
    return PdfStrategyDecisionSchema.parse({
      schemaVersion: 1,
      primaryStrategy: "original-source",
      fallbackStrategies: [],
      reason: "source-permission-required",
      canDownloadOriginal: true,
      canCaptureViewer: false,
    });
  }
  return undefined;
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - PAGE_COVERAGE_EPSILON_CSS &&
    inner.y >= outer.y - PAGE_COVERAGE_EPSILON_CSS &&
    inner.x + inner.width <= outer.x + outer.width + PAGE_COVERAGE_EPSILON_CSS &&
    inner.y + inner.height <= outer.y + outer.height + PAGE_COVERAGE_EPSILON_CSS
  );
}

function intersectRect(left: Rect, right: Rect): Rect | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  if (rightEdge <= x || bottomEdge <= y) return undefined;
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

function effectiveTileRect(tile: CaptureTile): Rect {
  return tile.outputRectCss ?? tile.sourceRectCss;
}

function pageCoveredByTiles(page: Rect, tiles: readonly CaptureTile[]): boolean {
  const intersections = tiles
    .map((tile) => intersectRect(page, effectiveTileRect(tile)))
    .filter((rect): rect is Rect => rect !== undefined);
  if (intersections.length === 0) return false;

  const yBreaks = new Set<number>([page.y, page.y + page.height]);
  for (const rect of intersections) {
    yBreaks.add(Math.max(page.y, rect.y));
    yBreaks.add(Math.min(page.y + page.height, rect.y + rect.height));
  }
  const orderedY = [...yBreaks].sort((left, right) => left - right);
  const pageRight = page.x + page.width;

  for (let index = 0; index < orderedY.length - 1; index += 1) {
    const top = orderedY[index];
    const bottom = orderedY[index + 1];
    if (top === undefined || bottom === undefined || bottom - top <= PAGE_COVERAGE_EPSILON_CSS) {
      continue;
    }
    const sampleY = (top + bottom) / 2;
    const intervals = intersections
      .filter(
        (rect) =>
          sampleY >= rect.y - PAGE_COVERAGE_EPSILON_CSS &&
          sampleY <= rect.y + rect.height + PAGE_COVERAGE_EPSILON_CSS,
      )
      .map((rect) => [Math.max(page.x, rect.x), Math.min(pageRight, rect.x + rect.width)] as const)
      .filter(([left, right]) => right > left)
      .sort((left, right) => left[0] - right[0]);
    if (intervals.length === 0) return false;

    let coveredRight = page.x;
    for (const [left, right] of intervals) {
      if (left > coveredRight + PAGE_COVERAGE_EPSILON_CSS) return false;
      coveredRight = Math.max(coveredRight, right);
      if (coveredRight >= pageRight - PAGE_COVERAGE_EPSILON_CSS) break;
    }
    if (coveredRight < pageRight - PAGE_COVERAGE_EPSILON_CSS) return false;
  }
  return true;
}

function viewerPagesFromJob(job: CaptureJob): PdfPageManifest[] {
  const pageMap = job.documentPageMap;
  if (
    pageMap === undefined ||
    !pageMap.complete ||
    pageMap.pages.length !== pageMap.sourcePageCount
  ) {
    throw pdfError(
      "The viewer does not have a complete logical PDF page map.",
      "PdfPageMapIncomplete",
      {
        jobId: job.id.slice(0, 24),
        mappedPages: pageMap?.pages.length ?? 0,
        expectedPages: pageMap?.sourcePageCount ?? 0,
      },
    );
  }
  const target = job.targetRect;
  if (target === undefined) {
    throw pdfError("The viewer capture target is unavailable.", "PdfViewerTargetMissing", {
      jobId: job.id.slice(0, 24),
    });
  }
  if (
    job.tilePlan.length === 0 ||
    job.completedTiles !== job.totalTiles ||
    job.tilePlan.some((tile) => tile.status !== "stored")
  ) {
    throw pdfError("The viewer capture is not durably stored yet.", "PdfViewerCaptureIncomplete", {
      jobId: job.id.slice(0, 24),
      completedTiles: job.completedTiles,
      totalTiles: job.totalTiles,
    });
  }

  return pageMap.pages.map((page) => {
    if (
      !containsRect(target, page.sourceRectCss) ||
      !pageCoveredByTiles(page.sourceRectCss, job.tilePlan)
    ) {
      throw pdfError(
        "A logical PDF page is not completely covered by captured pixels.",
        "PdfPageCoverageGap",
        {
          jobId: job.id.slice(0, 24),
          pageIndex: page.index,
        },
      );
    }
    return {
      index: page.index,
      identity: `s27-page-${page.index}`,
      sourceRectCss: page.sourceRectCss,
      widthCss: page.sourceRectCss.width,
      heightCss: page.sourceRectCss.height,
      orientation: page.sourceRectCss.width > page.sourceRectCss.height ? "landscape" : "portrait",
      discoveryConfidence: pageMap.confidence,
      state: "captured",
    };
  });
}

function createViewerManifest(
  job: CaptureJob,
  pages: PdfPageManifest[],
  now: Date,
  ttlMs: number,
): PdfDocumentManifest {
  const pageMap = job.documentPageMap;
  if (pageMap === undefined) {
    throw pdfError("The PDF page map is unavailable.", "PdfPageMapMissing", {
      jobId: job.id.slice(0, 24),
    });
  }
  return PdfDocumentManifestSchema.parse({
    schemaVersion: 1,
    revision: 0,
    jobId: job.id,
    sourceIdentity: `capture-job:${job.id}`,
    sourceStrategy: pageMap.strategy === "dom" ? "semantic-viewer" : "visual-discovery",
    viewerAdapter: pageMap.strategy === "dom" ? "s27-dom" : "s27-projected",
    expectedPageCount: pageMap.sourcePageCount,
    discoveryComplete: true,
    pages,
    state: "capturing",
    progress: derivePdfPageProgress(pages, pageMap.sourcePageCount, 0),
    outputState: "not-started",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: addMilliseconds(now, ttlMs),
  });
}

function sourceOrderPlan(pages: readonly PdfPageManifest[]): PdfOutputPlan {
  return {
    kind: "source-order",
    sourcePageIndexes: pages.map((page) => page.index),
  };
}

function sameOutputPlan(left: PdfOutputPlan | undefined, right: PdfOutputPlan): boolean {
  return (
    left !== undefined &&
    left.kind === right.kind &&
    left.editRevision === right.editRevision &&
    left.sourcePageIndexes.length === right.sourcePageIndexes.length &&
    left.sourcePageIndexes.every((value, index) => value === right.sourcePageIndexes[index])
  );
}

function atLeastVerified(page: PdfPageManifest): boolean {
  return page.state === "verified" || page.state === "written";
}

function isRevisionConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    (error as { data?: { causeCode?: unknown } }).data?.causeCode === "PdfManifestRevisionConflict"
  );
}

export class PdfCaptureOrchestrator implements PdfCaptureOrchestratorPort {
  private readonly manifests: PdfDocumentManifestRepositoryPort;
  private readonly now: () => Date;
  private readonly manifestTtlMs: number;

  constructor(options: PdfCaptureOrchestratorOptions) {
    this.manifests = options.manifests;
    this.now = options.now ?? (() => new Date());
    this.manifestTtlMs = options.manifestTtlMs ?? DEFAULT_MANIFEST_TTL_MS;
  }

  getManifest(jobId: string): Promise<PdfDocumentManifest | undefined> {
    return this.manifests.get(jobId);
  }

  async prepareViewerExport(
    job: CaptureJob,
    requestedOutputPlan?: PdfOutputPlan,
  ): Promise<PdfDocumentManifest> {
    if (!isDedicatedViewerPdfJob(job) || job.partialCapture !== undefined) {
      throw pdfError(
        "The capture job is not a complete dedicated viewer PDF.",
        "PdfViewerJobNotDedicated",
        {
          jobId: job.id.slice(0, 24),
          mode: job.mode,
          partial: job.partialCapture !== undefined,
        },
      );
    }

    const pages = viewerPagesFromJob(job);
    const outputPlan = requestedOutputPlan ?? sourceOrderPlan(pages);
    let manifest = await this.manifests.get(job.id);
    if (manifest === undefined) {
      manifest = createViewerManifest(job, pages, this.now(), this.manifestTtlMs);
      await this.manifests.create(manifest);
    }
    if (manifest.jobId !== job.id || manifest.expectedPageCount !== pages.length) {
      throw pdfError(
        "The PDF manifest does not match the captured viewer document.",
        "PdfManifestJobMismatch",
        {
          jobId: job.id.slice(0, 24),
          manifestPages: manifest.expectedPageCount ?? 0,
          capturedPages: pages.length,
        },
      );
    }

    if (manifest.state === "writing") {
      if (!sameOutputPlan(manifest.outputPlan, outputPlan)) {
        throw pdfError(
          "A PDF export is already using a different verified output plan.",
          "PdfOutputPlanChanged",
          { jobId: job.id.slice(0, 24) },
        );
      }
      return manifest;
    }

    if (manifest.state === "paused") {
      if (!sameOutputPlan(manifest.outputPlan, outputPlan)) {
        throw pdfError(
          "A paused PDF export cannot resume with a different verified output plan.",
          "PdfOutputPlanChanged",
          { jobId: job.id.slice(0, 24) },
        );
      }
      const now = this.now();
      const writing = transitionPdfManifest(manifest, "writing", now.toISOString(), {
        outputState: "writing",
        error: undefined,
        expiresAt: addMilliseconds(now, this.manifestTtlMs),
      });
      if (!writing.ok) throw createWebCapRuntimeError(writing.error);
      await this.manifests.save(writing.value, manifest.revision);
      return writing.value;
    }

    if (manifest.state === "completed") {
      const now = this.now();
      const writing = transitionPdfManifest(manifest, "writing", now.toISOString(), {
        outputPlan,
        progress: derivePdfPageProgress(
          manifest.pages,
          manifest.expectedPageCount,
          manifest.progress.currentBatch,
          undefined,
          0,
        ),
        outputState: "writing",
        error: undefined,
        expiresAt: addMilliseconds(now, this.manifestTtlMs),
      });
      if (!writing.ok) throw createWebCapRuntimeError(writing.error);
      await this.manifests.save(writing.value, manifest.revision);
      return writing.value;
    }

    const verifiedPages = manifest.pages.map((page) =>
      atLeastVerified(page) ? page : { ...page, state: "verified" as const },
    );
    const now = this.now();
    const verifying = transitionPdfManifest(manifest, "verifying", now.toISOString(), {
      pages: verifiedPages,
      progress: derivePdfPageProgress(
        verifiedPages,
        manifest.expectedPageCount,
        manifest.progress.currentBatch,
      ),
      lastVerifiedPage: verifiedPages.at(-1)?.index,
      error: undefined,
      expiresAt: addMilliseconds(now, this.manifestTtlMs),
    });
    if (!verifying.ok) throw createWebCapRuntimeError(verifying.error);
    await this.manifests.save(verifying.value, manifest.revision);

    const writingAt = this.now();
    const writing = transitionPdfManifest(verifying.value, "writing", writingAt.toISOString(), {
      outputPlan,
      progress: derivePdfPageProgress(
        verifying.value.pages,
        verifying.value.expectedPageCount,
        verifying.value.progress.currentBatch,
        undefined,
        0,
      ),
      outputState: "writing",
      expiresAt: addMilliseconds(writingAt, this.manifestTtlMs),
    });
    if (!writing.ok) throw createWebCapRuntimeError(writing.error);
    await this.manifests.save(writing.value, verifying.value.revision);
    return writing.value;
  }

  async recordOutputProgress(
    jobId: string,
    completedPages: number,
    totalPages: number,
  ): Promise<PdfDocumentManifest | undefined> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const manifest = await this.manifests.get(jobId);
      if (manifest === undefined) return undefined;
      const plan = manifest.outputPlan;
      const plannedPages = plan?.sourcePageIndexes.length ?? 0;
      if (plan === undefined || totalPages !== plannedPages || completedPages > plannedPages) {
        throw pdfError(
          "PDF writer progress does not match the verified output plan.",
          "PdfOutputProgressMismatch",
          {
            jobId: jobId.slice(0, 24),
            plannedPages,
            completedPages,
            totalPages,
          },
        );
      }
      if (manifest.state === "completed") return manifest;
      if (manifest.state !== "writing") {
        throw pdfError(
          "PDF output progress arrived outside the writing state.",
          "PdfOutputProgressState",
          { jobId: jobId.slice(0, 24), state: manifest.state },
        );
      }
      if (completedPages < manifest.progress.outputPages) return manifest;

      const writtenIndexes = new Set(plan.sourcePageIndexes.slice(0, completedPages));
      const pages = manifest.pages.map((page) =>
        writtenIndexes.has(page.index) && page.state !== "written"
          ? { ...page, state: "written" as const }
          : page,
      );
      const nextSourcePage = plan.sourcePageIndexes[completedPages];
      const now = this.now();
      const updated = updatePdfManifest(manifest, now.toISOString(), {
        pages,
        progress: derivePdfPageProgress(
          pages,
          manifest.expectedPageCount,
          manifest.progress.currentBatch,
          nextSourcePage,
          completedPages,
        ),
        outputState: completedPages === plannedPages ? "verifying" : "writing",
        expiresAt: addMilliseconds(now, this.manifestTtlMs),
      });
      if (!updated.ok) throw createWebCapRuntimeError(updated.error);
      try {
        await this.manifests.save(updated.value, manifest.revision);
        return updated.value;
      } catch (error) {
        if (!isRevisionConflict(error) || attempt === 2) throw error;
      }
    }
    return this.manifests.get(jobId);
  }

  async completeViewerOutput(
    job: CaptureJob,
    outputPageCount: number,
  ): Promise<PdfCompletionEvidence> {
    let manifest = await this.manifests.get(job.id);
    if (manifest === undefined) {
      manifest = await this.prepareViewerExport(job);
    }
    if (manifest.state !== "writing" && manifest.state !== "completed") {
      manifest = await this.prepareViewerExport(job, manifest.outputPlan);
    }
    const sourcePageCount = manifest.expectedPageCount;
    const plannedOutputPageCount = manifest.outputPlan?.sourcePageIndexes.length;
    if (
      sourcePageCount === undefined ||
      plannedOutputPageCount === undefined ||
      outputPageCount !== plannedOutputPageCount
    ) {
      throw pdfError(
        "Generated PDF page count does not match the verified output plan.",
        "PdfOutputPageCountMismatch",
        {
          jobId: job.id.slice(0, 24),
          sourcePages: sourcePageCount ?? 0,
          plannedOutputPages: plannedOutputPageCount ?? 0,
          outputPages: outputPageCount,
        },
      );
    }
    if (manifest.pages.some((page) => !atLeastVerified(page))) {
      throw pdfError(
        "Not every source PDF page has been verified before completion.",
        "PdfPagesUnverified",
        {
          jobId: job.id.slice(0, 24),
          verifiedPages: manifest.progress.verifiedPages,
          sourcePages: sourcePageCount,
        },
      );
    }
    if (manifest.state === "completed") {
      return PdfCompletionEvidenceSchema.parse({
        schemaVersion: 1,
        jobId: job.id,
        manifestRevision: manifest.revision,
        sourcePageCount,
        expectedOutputPageCount: plannedOutputPageCount,
        outputPageCount,
        verified: true,
      });
    }

    const writtenIndexes = new Set(manifest.outputPlan?.sourcePageIndexes ?? []);
    const writtenPages = manifest.pages.map((page) =>
      writtenIndexes.has(page.index) && page.state !== "written"
        ? { ...page, state: "written" as const }
        : page,
    );
    const now = this.now();
    const completed = transitionPdfManifest(manifest, "completed", now.toISOString(), {
      pages: writtenPages,
      progress: derivePdfPageProgress(
        writtenPages,
        sourcePageCount,
        manifest.progress.currentBatch,
        undefined,
        plannedOutputPageCount,
      ),
      outputState: "completed",
      lastVerifiedPage: writtenPages.at(-1)?.index,
      error: undefined,
      expiresAt: addMilliseconds(now, this.manifestTtlMs),
    });
    if (!completed.ok) throw createWebCapRuntimeError(completed.error);
    await this.manifests.save(completed.value, manifest.revision);
    return PdfCompletionEvidenceSchema.parse({
      schemaVersion: 1,
      jobId: job.id,
      manifestRevision: completed.value.revision,
      sourcePageCount,
      expectedOutputPageCount: plannedOutputPageCount,
      outputPageCount,
      verified: true,
    });
  }

  async recordPause(jobId: string, error: WebCapErrorData): Promise<void> {
    const manifest = await this.manifests.get(jobId);
    if (
      manifest === undefined ||
      manifest.state === "completed" ||
      manifest.state === "cancelled" ||
      manifest.state === "failed"
    ) {
      return;
    }
    if (manifest.state === "paused") {
      const now = this.now();
      const updated = updatePdfManifest(manifest, now.toISOString(), {
        error,
        expiresAt: addMilliseconds(now, this.manifestTtlMs),
      });
      if (!updated.ok) throw createWebCapRuntimeError(updated.error);
      await this.manifests.save(updated.value, manifest.revision);
      return;
    }
    const now = this.now();
    const paused = transitionPdfManifest(manifest, "paused", now.toISOString(), {
      error,
      expiresAt: addMilliseconds(now, this.manifestTtlMs),
    });
    if (!paused.ok) throw createWebCapRuntimeError(paused.error);
    await this.manifests.save(paused.value, manifest.revision);
  }

  async recordFailure(jobId: string, error: WebCapErrorData): Promise<void> {
    const manifest = await this.manifests.get(jobId);
    if (
      manifest === undefined ||
      manifest.state === "completed" ||
      manifest.state === "cancelled" ||
      manifest.state === "failed"
    ) {
      return;
    }
    const now = this.now();
    const failed = transitionPdfManifest(manifest, "failed", now.toISOString(), {
      error,
      expiresAt: addMilliseconds(now, this.manifestTtlMs),
    });
    if (!failed.ok) throw createWebCapRuntimeError(failed.error);
    await this.manifests.save(failed.value, manifest.revision);
  }
}
