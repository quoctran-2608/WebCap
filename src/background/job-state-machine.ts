import { CaptureJobSchema, type CaptureJob, type JobState } from "@shared/contracts/domain";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

export const TERMINAL_JOB_STATES = Object.freeze(["completed", "cancelled"] as const);

const ALLOWED_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = Object.freeze({
  created: ["preparing"],
  preparing: ["capturing", "failed", "cancelling"],
  capturing: ["processing", "failed", "cancelling"],
  processing: ["ready", "failed", "cancelling"],
  ready: ["exporting", "cancelling"],
  exporting: ["completed", "ready", "failed", "cancelling"],
  completed: [],
  failed: ["preparing", "capturing", "exporting", "cancelled"],
  cancelling: ["cancelled"],
  cancelled: [],
});

export interface JobInvariantContext {
  sourceArtifactExists?: boolean;
}

export type JobTransitionPatch = Partial<
  Pick<
    CaptureJob,
    | "activeEngine"
    | "metrics"
    | "targetRect"
    | "tilePlan"
    | "completedTiles"
    | "totalTiles"
    | "cleanup"
    | "error"
    | "expiresAt"
  >
>;

function stateError(
  message: string,
  causeCode: string,
  safeContext: Record<string, string | number | boolean>,
): WebCapErrorData {
  return createWebCapError({
    code: "E_PROTOCOL_MESSAGE",
    stage: "protocol",
    message,
    userMessageKey: "errors.jobState",
    retryable: false,
    fallbackAllowed: false,
    causeCode,
    safeContext,
  });
}

export function isTerminalJobState(state: JobState): boolean {
  return TERMINAL_JOB_STATES.includes(state as (typeof TERMINAL_JOB_STATES)[number]);
}

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function validateJobInvariants(
  job: CaptureJob,
  context: JobInvariantContext = {},
): Result<void, WebCapErrorData> {
  if (job.completedTiles > job.totalTiles) {
    return err(
      stateError("Completed tile count cannot exceed total tiles.", "CompletedTilesOverflow", {
        completedTiles: job.completedTiles,
        totalTiles: job.totalTiles,
      }),
    );
  }

  if (job.totalTiles !== job.tilePlan.length) {
    return err(
      stateError("Job totalTiles must match tile plan length.", "TilePlanLengthMismatch", {
        totalTiles: job.totalTiles,
        tilePlanLength: job.tilePlan.length,
      }),
    );
  }

  const tileIds = new Set<string>();
  const tileIndexes = new Set<number>();
  for (const tile of job.tilePlan) {
    if (tile.jobId !== job.id) {
      return err(
        stateError("Every tile must belong to its capture job.", "TileJobMismatch", {
          tileIndex: tile.index,
        }),
      );
    }
    if (tileIds.has(tile.id) || tileIndexes.has(tile.index)) {
      return err(
        stateError("Tile identifiers and indexes must be unique.", "DuplicateTile", {
          tileIndex: tile.index,
        }),
      );
    }
    tileIds.add(tile.id);
    tileIndexes.add(tile.index);
  }

  if (job.cleanup.completed && !job.cleanup.attempted) {
    return err(
      stateError("Completed cleanup must be marked as attempted.", "CleanupNotAttempted", {
        state: job.state,
      }),
    );
  }

  if (job.state === "capturing" && (job.activeEngine === undefined || job.totalTiles === 0)) {
    return err(
      stateError(
        "Capturing requires an active engine and a non-empty tile plan.",
        "CapturePrerequisitesMissing",
        { totalTiles: job.totalTiles, hasActiveEngine: job.activeEngine !== undefined },
      ),
    );
  }

  if (job.state === "ready") {
    const allStored =
      job.totalTiles > 0 &&
      job.completedTiles === job.totalTiles &&
      job.tilePlan.every((tile) => tile.status === "stored");
    if (!allStored) {
      return err(
        stateError("Ready requires every planned tile to be stored.", "ReadyTilesIncomplete", {
          completedTiles: job.completedTiles,
          totalTiles: job.totalTiles,
        }),
      );
    }
  }

  if (job.state === "exporting" && context.sourceArtifactExists !== true) {
    return err(
      stateError("Exporting requires an existing source artifact.", "SourceArtifactMissing", {
        sourceArtifactExists: false,
      }),
    );
  }

  if (job.state === "failed" && job.error === undefined) {
    return err(
      stateError("Failed jobs require a normalized error.", "FailureErrorMissing", {
        state: job.state,
      }),
    );
  }

  if (["completed", "failed", "cancelled"].includes(job.state)) {
    const cleanupSettled =
      job.cleanup.attempted && (job.cleanup.completed || job.cleanup.error !== undefined);
    if (!cleanupSettled) {
      return err(
        stateError(
          "Completed, failed, and cancelled jobs require settled cleanup metadata.",
          "CleanupUnsettled",
          { state: job.state },
        ),
      );
    }
  }

  return ok(undefined);
}

export function transitionJob(
  job: CaptureJob,
  nextState: JobState,
  updatedAt: string,
  patch: JobTransitionPatch = {},
  context: JobInvariantContext = {},
): Result<CaptureJob, WebCapErrorData> {
  if (!canTransitionJob(job.state, nextState)) {
    return err(
      stateError("Capture job transition is not allowed.", "InvalidJobTransition", {
        from: job.state,
        to: nextState,
      }),
    );
  }

  const candidate = CaptureJobSchema.safeParse({
    ...job,
    ...patch,
    state: nextState,
    stateRevision: job.stateRevision + 1,
    updatedAt,
  });
  if (!candidate.success) {
    return err(
      stateError("Capture job mutation does not match the domain schema.", "InvalidJobMutation", {
        from: job.state,
        to: nextState,
      }),
    );
  }

  const invariant = validateJobInvariants(candidate.data, context);
  return invariant.ok ? ok(candidate.data) : invariant;
}
