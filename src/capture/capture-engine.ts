import type {
  CaptureEngineKind,
  CaptureJob,
  CaptureSettings,
  CaptureTile,
  PageMetrics,
  Rect,
} from "@shared/contracts/domain";
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
  throwIfCancelled(stage?: "prepare" | "measure" | "plan" | "capture" | "cleanup"): void;
}

export interface CaptureEngineContext {
  jobId: string;
  tabId: number;
  settings: CaptureSettings;
  targetRect?: Rect;
  cancellation: CaptureCancellation;
  onPlan(metrics: PageMetrics, targetRect: Rect, tiles: CaptureTile[]): Promise<void>;
  storeTile(tile: CaptureTile, blob: Blob): Promise<void>;
  reportProgress(progress: CaptureProgress): Promise<void> | void;
}

export interface CaptureEngineResult {
  metrics: PageMetrics;
  targetRect: Rect;
  tiles: CaptureTile[];
}

export interface CaptureEngine {
  readonly kind: CaptureEngineKind;
  capture(context: CaptureEngineContext): Promise<CaptureEngineResult>;
}
