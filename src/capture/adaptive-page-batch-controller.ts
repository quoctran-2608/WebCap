import type { DocumentPage } from "@shared/contracts/domain";

import { estimatePdfPageCaptureTiles } from "./pdf-page-capture-planner";

export interface AdaptivePageBatch {
  batchIndex: number;
  startPageIndex: number;
  endPageIndexExclusive: number;
  pageIndexes: number[];
  estimatedTiles: number;
  estimatedRasterBytes: number;
}

export interface AdaptivePageBatchOutcome {
  durationMs: number;
  storedBytes: number;
  pressure?: boolean;
}

export interface AdaptivePageBatchControllerOptions {
  documentWidth: number;
  documentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  pixelScale: number;
  overlapCss: number;
  maxTilesPerBatch: number;
  maxEstimatedBytesPerBatch: number;
  minimumPagesPerBatch?: number;
  maximumPagesPerBatch?: number;
  initialPagesPerBatch?: number;
}

const DEFAULT_MINIMUM_PAGES = 1;
const DEFAULT_MAXIMUM_PAGES = 25;
const DEFAULT_INITIAL_PAGES = 10;
const SLOW_BATCH_MS = 15_000;

function boundedInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

export class AdaptivePageBatchController {
  private readonly options: AdaptivePageBatchControllerOptions;
  private readonly minimumPages: number;
  private readonly maximumPages: number;
  private targetPages: number;
  private batchIndex = 0;

  constructor(options: AdaptivePageBatchControllerOptions) {
    this.options = options;
    this.minimumPages = boundedInteger(
      options.minimumPagesPerBatch ?? DEFAULT_MINIMUM_PAGES,
      1,
      DEFAULT_MAXIMUM_PAGES,
    );
    this.maximumPages = boundedInteger(
      options.maximumPagesPerBatch ?? DEFAULT_MAXIMUM_PAGES,
      this.minimumPages,
      DEFAULT_MAXIMUM_PAGES,
    );
    this.targetPages = boundedInteger(
      options.initialPagesPerBatch ?? DEFAULT_INITIAL_PAGES,
      this.minimumPages,
      this.maximumPages,
    );
  }

  nextBatch(pages: readonly DocumentPage[], startPageIndex: number): AdaptivePageBatch | undefined {
    if (startPageIndex >= pages.length) return undefined;
    const maxTiles = Math.max(1, Math.floor(this.options.maxTilesPerBatch));
    const maxBytes = Math.max(1, Math.floor(this.options.maxEstimatedBytesPerBatch));
    const pageIndexes: number[] = [];
    let estimatedTiles = 0;
    let estimatedRasterBytes = 0;

    for (let position = startPageIndex; position < pages.length; position += 1) {
      const page = pages[position];
      if (page === undefined) break;
      const estimate = estimatePdfPageCaptureTiles({
        pageRect: page.sourceRectCss,
        documentWidth: this.options.documentWidth,
        documentHeight: this.options.documentHeight,
        viewportWidth: this.options.viewportWidth,
        viewportHeight: this.options.viewportHeight,
        overlapCss: this.options.overlapCss,
      });
      const pageBytes = Math.max(
        4,
        Math.ceil(
          page.sourceRectCss.width *
            page.sourceRectCss.height *
            this.options.pixelScale *
            this.options.pixelScale *
            4,
        ),
      );
      const wouldExceed =
        pageIndexes.length > 0 &&
        (pageIndexes.length >= this.targetPages ||
          estimatedTiles + estimate.tileCount > maxTiles ||
          estimatedRasterBytes + pageBytes > maxBytes);
      if (wouldExceed) break;

      pageIndexes.push(page.index);
      estimatedTiles += estimate.tileCount;
      estimatedRasterBytes += pageBytes;

      // A single large page is always allowed to become a one-page batch. The page-local
      // planner owns its own independent safety budget and will reject an unsafe page.
      if (pageIndexes.length === 1 && (estimatedTiles > maxTiles || estimatedRasterBytes > maxBytes)) {
        break;
      }
    }

    if (pageIndexes.length === 0) return undefined;
    const batch: AdaptivePageBatch = {
      batchIndex: this.batchIndex,
      startPageIndex,
      endPageIndexExclusive: startPageIndex + pageIndexes.length,
      pageIndexes,
      estimatedTiles,
      estimatedRasterBytes,
    };
    this.batchIndex += 1;
    return batch;
  }

  recordOutcome(outcome: AdaptivePageBatchOutcome): void {
    const pressure = outcome.pressure === true || outcome.durationMs >= SLOW_BATCH_MS;
    if (pressure) {
      this.targetPages = Math.max(this.minimumPages, Math.floor(this.targetPages / 2));
      return;
    }

    const byteBudget = Math.max(1, this.options.maxEstimatedBytesPerBatch);
    const comfortablySmall = outcome.storedBytes <= byteBudget / 3 && outcome.durationMs < SLOW_BATCH_MS / 2;
    if (comfortablySmall) {
      this.targetPages = Math.min(this.maximumPages, this.targetPages + 2);
    }
  }

  getTargetPages(): number {
    return this.targetPages;
  }
}
