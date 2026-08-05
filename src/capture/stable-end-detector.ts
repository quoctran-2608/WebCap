import type { AdaptiveCaptureFrontier } from "@shared/contracts/domain";

export const ADAPTIVE_STABLE_BOTTOM_ROUNDS = 3;
export const ADAPTIVE_BOTTOM_EPSILON_CSS = 2;

export interface StableEndObservation {
  actualScrollY: number;
  viewportHeight: number;
  documentHeight: number;
  stableSamples: number;
  mutationCount: number;
  observedAt: string;
}

export interface StableEndResult {
  frontier: AdaptiveCaptureFrontier;
  atBottom: boolean;
  grew: boolean;
  complete: boolean;
}

export function observeStableEnd(
  frontier: AdaptiveCaptureFrontier,
  observation: StableEndObservation,
  requiredStableRounds = ADAPTIVE_STABLE_BOTTOM_ROUNDS,
  epsilonCss = ADAPTIVE_BOTTOM_EPSILON_CSS,
): StableEndResult {
  const observedHeight = Math.max(frontier.observedDocumentHeightCss, observation.documentHeight);
  const grew = observation.documentHeight > frontier.observedDocumentHeightCss + epsilonCss;
  const atBottom =
    observation.actualScrollY + observation.viewportHeight >= observation.documentHeight - epsilonCss;
  const settledAtBottom = atBottom && !grew && observation.stableSamples > 0;
  const stableBottomRounds = grew
    ? 0
    : settledAtBottom
      ? frontier.stableBottomRounds + 1
      : 0;
  const complete = stableBottomRounds > Math.max(0, requiredStableRounds);

  return {
    frontier: {
      ...frontier,
      observedDocumentHeightCss: observedHeight,
      stableBottomRounds,
      ...(grew ? { lastGrowthAt: observation.observedAt } : {}),
    },
    atBottom,
    grew,
    complete,
  };
}
