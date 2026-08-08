import type {
  CaptureCancellation,
  CaptureEngine,
  CaptureEngineContext,
  CaptureEngineResult,
  CaptureProgress,
} from "@capture/capture-engine";
import { PageNativeCaptureEngine } from "@capture/page-native-capture-engine";

import {
  ScrollAreaCaptureEngine as GenericScrollAreaCaptureEngine,
  type ScrollAreaCaptureEngineOptions as GenericScrollAreaCaptureEngineOptions,
} from "./generic-scroll-area-capture-engine";

export type ScrollAreaCaptureEngineOptions = GenericScrollAreaCaptureEngineOptions;

function descriptorSuggestsPdf(context: CaptureEngineContext): boolean {
  const descriptor = context.targetDescriptor;
  if (descriptor === undefined) return false;
  const hint = [descriptor.tagName, descriptor.id ?? "", ...descriptor.classNames]
    .join(" ")
    .toLowerCase();
  return /(?:pdf|document|viewer)/u.test(hint);
}

class PageBoundaryCancellation implements CaptureCancellation {
  private deferKeepPartial = false;

  constructor(private readonly source: CaptureCancellation) {}

  get cancelled(): boolean {
    return this.source.cancelled;
  }

  get keepPartial(): boolean {
    return this.source.keepPartial;
  }

  markCaptureStarted(): void {
    this.deferKeepPartial = true;
  }

  markBoundary(): void {
    this.deferKeepPartial = false;
  }

  throwIfCancelled(stage?: "prepare" | "measure" | "plan" | "capture" | "cleanup"): void {
    if (this.cancelled && this.keepPartial && this.deferKeepPartial) return;
    this.source.throwIfCancelled(stage);
  }
}

export class ScrollAreaCaptureEngine implements CaptureEngine {
  readonly kind = "scroll" as const;
  private readonly generic: GenericScrollAreaCaptureEngine;
  private readonly pageNative: PageNativeCaptureEngine;

  constructor(options: ScrollAreaCaptureEngineOptions) {
    this.generic = new GenericScrollAreaCaptureEngine(options);
    this.pageNative = new PageNativeCaptureEngine({
      pages: options.pages,
      tabs: options.tabs,
      fallback: this.generic,
      ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
      ...(options.overlapCss === undefined ? {} : { overlapCss: options.overlapCss }),
    });
  }

  capture(context: CaptureEngineContext): Promise<CaptureEngineResult> {
    if (!descriptorSuggestsPdf(context)) return this.generic.capture(context);

    const cancellation = new PageBoundaryCancellation(context.cancellation);
    const reportProgress = async (progress: CaptureProgress): Promise<void> => {
      if (progress.stage === "capturing") cancellation.markCaptureStarted();
      if (progress.stage === "storing") cancellation.markBoundary();
      await context.reportProgress(progress);
    };
    return this.pageNative.capture({ ...context, cancellation, reportProgress });
  }

  cleanup(context: CaptureEngineContext): Promise<void> {
    return this.generic.cleanup(context);
  }
}
