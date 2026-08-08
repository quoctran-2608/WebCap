import type { CaptureEngine, CaptureEngineContext, CaptureEngineResult } from "@capture/capture-engine";
import { PageNativeCaptureEngine } from "@capture/page-native-capture-engine";

import {
  GenericScrollAreaCaptureEngine,
  type GenericScrollAreaCaptureEngineOptions,
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
    return descriptorSuggestsPdf(context)
      ? this.pageNative.capture(context)
      : this.generic.capture(context);
  }

  cleanup(context: CaptureEngineContext): Promise<void> {
    return this.generic.cleanup(context);
  }
}
