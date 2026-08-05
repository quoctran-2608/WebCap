import type {
  AdaptiveCaptureFrontier,
  CaptureEngineKind,
  CaptureJob,
  CaptureMode,
  ElementTargetDescriptor,
  CaptureSettings,
  CaptureTile,
  PartialCapture,
  PageMetrics,
  Rect,
} from "@shared/contracts/domain";
import type { PagePreparationReadyPayload } from "@shared/contracts/page-preparation";
import type { CaptureProgressStage } from "@shared/contracts/job-progress";

export interface CaptureProgress {
  jobId: string;
  state: CaptureJob["state"];
  stage: CaptureProgressStage;
  completed: number;
  total: number;
  tileIndex?: number;
}

export interface CaptureCancellation {
  readonly cancelled: boolean;
  readonly keepPartial: boolean;
  throwIfCancelled(stage?: "prepare" | "measure" | "plan" | "capture" | "cleanup"): void;
}

export interface AdaptiveCaptureResumeState {
  frontier: AdaptiveCaptureFrontier;
  tilePlan: CaptureTile[];
  metrics?: PageMetrics;
}

export interface CaptureEngineContext {
  jobId: string;
  tabId: number;
  windowId?: number;
  mode?: CaptureMode;
  settings: CaptureSettings;
  targetRect?: Rect;
  targetDescriptor?: ElementTargetDescriptor;
  preparation?: PagePreparationReadyPayload;
  resume?: AdaptiveCaptureResumeState;
  cancellation: CaptureCancellation;
  onPlan(
    metrics: PageMetrics,
    targetRect: Rect,
    tiles: CaptureTile[],
    partialCapture?: PartialCapture,
  ): Promise<void>;
  checkpointFrontier?(frontier: AdaptiveCaptureFrontier): Promise<void>;
  storeTile(tile: CaptureTile, blob: Blob): Promise<void>;
  reportProgress(progress: CaptureProgress): Promise<void> | void;
}

export interface CaptureEngineResult {
  metrics: PageMetrics;
  targetRect: Rect;
  tiles: CaptureTile[];
  partialCapture?: PartialCapture;
}

export interface CaptureEngine {
  readonly kind: CaptureEngineKind;
  readonly adaptive?: boolean;
  capture(context: CaptureEngineContext): Promise<CaptureEngineResult>;
  cleanup?(context: CaptureEngineContext): Promise<void>;
}
