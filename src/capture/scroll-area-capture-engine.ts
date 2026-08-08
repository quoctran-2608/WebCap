import type { ScrollAreaPageAdapter } from "@background/scroll-area-page-adapter";
import type { TabsCaptureAdapter } from "@background/chrome-tabs-adapter";
import { PageNativeCaptureEngine } from "@capture/page-native-capture-engine";

import {
  GenericScrollAreaCaptureEngine,
  type GenericScrollAreaCaptureEngineOptions,
} from "./generic-scroll-area-capture-engine";

export type ScrollAreaCaptureEngineOptions = GenericScrollAreaCaptureEngineOptions;

function descriptorSuggestsPdf(options: ScrollAreaCaptureEngineOptions): GenericScrollAreaCaptureEngine {
  return new GenericScrollAreaCaptureEngine(options);
}

export class ScrollAreaCaptureEngine extends PageNativeCaptureEngine {
  constructor(options: ScrollAreaCaptureEngineOptions) {
    const fallback = descriptorSuggestsPdf(options);
    super({
      pages: options.pages as ScrollAreaPageAdapter,
      tabs: options.tabs as TabsCaptureAdapter,
      fallback,
      ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
      ...(options.overlapCss === undefined ? {} : { overlapCss: options.overlapCss }),
    });
  }
}
