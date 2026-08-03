import type { DebuggerClient } from "@background/debugger-client";
import { readPageMetrics } from "@capture/page-metrics";
import {
  planCaptureTiles,
  type TilePlan,
  type TilePlannerLimits,
} from "@capture/tile-planner";
import type { PageMetrics, Rect } from "@shared/contracts/domain";

export interface MeasureAndPlanRequest {
  tabId: number;
  jobId: string;
  targetRect?: Rect;
  pixelScale?: number;
  limits: TilePlannerLimits;
}

export interface MeasureAndPlanResult {
  metrics: PageMetrics;
  plan: TilePlan;
}

export class CdpMeasurementService {
  constructor(private readonly debuggerClient: DebuggerClient) {}

  measure(tabId: number): Promise<PageMetrics> {
    return this.debuggerClient.withSession(tabId, readPageMetrics);
  }

  measureAndPlan(request: MeasureAndPlanRequest): Promise<MeasureAndPlanResult> {
    return this.debuggerClient.withSession(request.tabId, async (session) => {
      const metrics = await readPageMetrics(session);
      const plan = planCaptureTiles({
        jobId: request.jobId,
        documentBounds: metrics.document,
        targetRect: request.targetRect ?? metrics.document,
        pixelScale: request.pixelScale ?? metrics.zoomFactor,
        limits: request.limits,
      });

      return { metrics, plan };
    });
  }
}
