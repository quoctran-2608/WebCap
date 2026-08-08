import { CaptureJobSchema, type CaptureJob, type JobState } from "@shared/contracts/domain";
import type { PdfCompletionEvidence } from "@shared/contracts/pdf-capture";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

export const TERMINAL_JOB_STATES = Object.freeze(["completed", "cancelled"] as const);

const ALLOWED_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = Object.freeze({
  created: ["preparing"],
  preparing: ["capturing", "paused", "failed", "cancelling"],
  capturing: ["processing", "paused", "failed", "cancelling"],
  processing: ["ready", "failed", "cancelling"],
  ready: ["exporting", "cancelling"],
  exporting: ["completed", "ready", "paused", "failed", "cancelling"],
  // Completed is quiescent by default, but a deliberate PDF-editor mutation may reopen
  // the durable tile source so a replacement artifact can be exported without recapture.
  completed: ["ready"],
  paused: ["preparing", "capturing", "exporting", "cancelling"],
  failed: ["preparing", "capturing", "exporting", "cancelled"],
  cancelling: ["cancelled"],
  cancelled: [],
});

export interface JobInvariantContext {
  sourceArtifactExists?: boolean;
  pdfCompletionEvidence?: PdfCompletionEvidence;
}

export type JobTransitionPatch = Partial<
  Pick<
    CaptureJob,
    | "activeEngine"
    | "metrics"
    | "targetRect"
    | "targetDescriptor"
    | "documentPageMap"
    | "tilePlan"
    | "completedTiles"
    | "totalTiles"
    | "adaptiveFrontier"
    | "cleanup"
    | "partialCapture"
    | "exportProgress"
    | "activeOutputFormat"
    | "output"
    | "outputArtifactId"
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

  if (job.documentPageMap !== undefined) {
    const pageMap = job.documentPageMap;
    if (job.mode !== "scroll-area") {
      return err(
        stateError(
          "Only scroll-area jobs may persist a document page map.",
          "DocumentPageModeMismatch",
          { mode: job.mode },
        ),
      );
    }
    if (pageMap.pages.length !== pageMap.sourcePageCount) {
      return err(
        stateError("Document page count must match the page map.", "DocumentPageCountMismatch", {
          sourcePageCount: pageMap.sourcePageCount,
          mappedPages: pageMap.pages.length,
        }),
      );
    }
    for (const [index, page] of pageMap.pages.entries()) {
      if (page.index !== index || page.sourceRectCss.width <= 0 || page.sourceRectCss.height <= 0) {
        return err(
          stateError("Document pages must be sequential and non-empty.", "DocumentPageMapInvalid", {
            expectedIndex: index,
            pageIndex: page.index,
          }),
        );
      }
    }
  }

  if (job.adaptiveFrontier !== undefined) {
    const frontier = job.adaptiveFrontier;
    if (job.mode !== "full-page") {
      return err(
        stateError(
          "Only full-page jobs may persist an adaptive frontier.",
          "AdaptiveModeMismatch",
          { mode: job.mode },
        ),
      );
    }
    if (Math.abs(frontier.nextYCss - frontier.capturedBottomCss) > 0.01) {
      return err(
        stateError("Adaptive nextY must match the committed bottom.", "AdaptiveFrontierGap", {
          nextYCss: frontier.nextYCss,
          capturedBottomCss: frontier.capturedBottomCss,
        }),
      );
    }
    if (frontier.capturedBottomCss > frontier.observedDocumentHeightCss + 0.01) {
      return err(
        stateError(
          "Adaptive committed coverage cannot exceed the observed document.",
          "AdaptiveCoverageOverflow",
          {
            capturedBottomCss: frontier.capturedBottomCss,
            observedDocumentHeightCss: frontier.observedDocumentHeightCss,
          },
        ),
      );
    }
  }

  if (
    job.exportProgress !== undefined &&
    job.exportProgress.completedPages > job.exportProgress.totalPages
  ) {
    return err(
      stateError("Completed PDF pages cannot exceed total pages.", "PdfProgressOverflow", {
        completedPages: job.exportProgress.completedPages,
        totalPages: job.exportProgress.totalPages,
      }),
    );
  }

  if (
    job.state === "completed" &&
    job.documentPageMap?.complete === true &&
    job.partialCapture === undefined &&
    job.activeOutputFormat === "pdf"
  ) {
    const evidence = context.pdfCompletionEvidence;
    const outputPages = job.output?.pageCount ?? 0;
    const expectedOutputPages = job.exportProgress?.totalPages ?? outputPages;
    const validEvidence =
      evidence?.verified === true &&
      evidence.jobId === job.id &&
      evidence.sourcePageCount === job.documentPageMap.sourcePageCount &&
      evidence.expectedOutputPageCount === expectedOutputPages &&
      evidence.outputPageCount === outputPages &&
      outputPages === expectedOutputPages;
    if (!validEvidence) {
      return err(
        stateError(
          "A dedicated PDF cannot complete without matching verified document-manifest evidence.",
          "PdfCompletionEvidenceMissing",
          {
            sourcePageCount: job.documentPageMap.sourcePageCount,
            expectedOutputPages,
            outputPages,
          },
        ),
      );
    }
  }

  if (
    job.output !== undefined &&
    job.outputArtifactId !== undefined &&
    job.output.artifactId !== job.outputArtifactId
  ) {
    return err(
      stateError(
        "Output metadata must match the persisted artifact ID.",
        "OutputArtifactMismatch",
        {
          outputArtifactId: job.outputArtifactId,
          metadataArtifactId: job.output.artifactId,
        },
      ),
    );
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

  if (job.state === "exporting" && job.exportProgress === undefined) {
    return err(
      stateError("PDF exporting requires initialized page progress.", "PdfProgressMissing", {
        hasExportProgress: false,
      }),
    );
  }

  if (job.state === "paused" && (job.error === undefined || !job.error.retryable)) {
    return err(
      stateError("Paused jobs require a retryable reason.", "PauseReasonMissing", {
        state: job.state,
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

function buildMutation(
  job: CaptureJob,
  updatedAt: string,
  patch: JobTransitionPatch,
  state: JobState,
): Result<CaptureJob, WebCapErrorData> {
  const candidate = CaptureJobSchema.safeParse({
    ...job,
    ...patch,
    state,
    stateRevision: job.stateRevision + 1,
    updatedAt,
  });
  if (!candidate.success) {
    return err(
      stateError("Capture job mutation does not match the domain schema.", "InvalidJobMutation", {
        from: job.state,
        to: state,
      }),
    );
  }
  return ok(candidate.data);
}

export function updateJob(
  job: CaptureJob,
  updatedAt: string,
  patch: JobTransitionPatch,
  context: JobInvariantContext = {},
): Result<CaptureJob, WebCapErrorData> {
  const candidate = buildMutation(job, updatedAt, patch, job.state);
  if (!candidate.ok) return candidate;
  const invariant = validateJobInvariants(candidate.value, context);
  return invariant.ok ? candidate : invariant;
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

  const candidate = buildMutation(job, updatedAt, patch, nextState);
  if (!candidate.ok) return candidate;
  const invariant = validateJobInvariants(candidate.value, context);
  return invariant.ok ? candidate : invariant;
}
