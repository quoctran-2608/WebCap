import type {
  CaptureCancellation,
  CaptureEngine,
  CaptureEngineContext,
  CaptureEngineResult,
  CaptureProgress,
} from "@capture/capture-engine";
import { PageNativeCaptureEngine } from "@capture/page-native-capture-engine";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

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

function isExplicitPdfCapture(context: CaptureEngineContext): boolean {
  return context.settings.outputFormat === "pdf";
}

function dedicatedPdfDiscoveryError(): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_LAYOUT_UNSTABLE",
      stage: "capture",
      message:
        "Dedicated PDF capture could not verify every logical source page. Generic raster fallback is disabled so incomplete output cannot be reported as successful.",
      userMessageKey: "errors.layoutChanged",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "PdfPageMapUnverified",
    }),
  );
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
  private readonly dedicatedPageNative: PageNativeCaptureEngine;

  constructor(options: ScrollAreaCaptureEngineOptions) {
    this.generic = new GenericScrollAreaCaptureEngine(options);
    this.pageNative = new PageNativeCaptureEngine({
      pages: options.pages,
      tabs: options.tabs,
      fallback: this.generic,
      ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
      ...(options.overlapCss === undefined ? {} : { overlapCss: options.overlapCss }),
    });

    const forcedPdfPages = {
      scrollAndSettle: (request: Parameters<typeof options.pages.scrollAndSettle>[0]) =>
        options.pages.scrollAndSettle({ ...request, forcePdfDiscovery: true }),
      cleanup: (...args: Parameters<typeof options.pages.cleanup>) => options.pages.cleanup(...args),
    };
    const failClosedFallback: CaptureEngine = {
      kind: "scroll",
      capture: () => Promise.reject(dedicatedPdfDiscoveryError()),
    };
    this.dedicatedPageNative = new PageNativeCaptureEngine({
      pages: forcedPdfPages,
      tabs: options.tabs,
      fallback: failClosedFallback,
      ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
      ...(options.overlapCss === undefined ? {} : { overlapCss: options.overlapCss }),
    });
  }

  capture(context: CaptureEngineContext): Promise<CaptureEngineResult> {
    const explicitPdf = isExplicitPdfCapture(context);
    if (!explicitPdf && !descriptorSuggestsPdf(context)) {
      return this.generic.capture(context);
    }

    const cancellation = new PageBoundaryCancellation(context.cancellation);
    const reportProgress = async (progress: CaptureProgress): Promise<void> => {
      if (progress.stage === "capturing") cancellation.markCaptureStarted();
      if (progress.stage === "storing") cancellation.markBoundary();
      await context.reportProgress(progress);
    };
    const engine = explicitPdf ? this.dedicatedPageNative : this.pageNative;
    return engine.capture({ ...context, cancellation, reportProgress });
  }

  cleanup(context: CaptureEngineContext): Promise<void> {
    return this.generic.cleanup(context);
  }
}
