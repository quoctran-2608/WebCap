import {
  PdfDocumentManifestSchema,
  type PdfDocumentManifest,
  type PdfManifestState,
  type PdfOutputPlan,
  type PdfPageLifecycleState,
  type PdfPageManifest,
  type PdfPageProgress,
} from "@shared/contracts/pdf-capture";
import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

const PAGE_STATE_RANK: Readonly<Record<PdfPageLifecycleState, number>> = Object.freeze({
  discovered: 0,
  capturing: 1,
  captured: 2,
  verified: 3,
  written: 4,
});

const ALLOWED_TRANSITIONS: Readonly<Record<PdfManifestState, readonly PdfManifestState[]>> =
  Object.freeze({
    created: ["negotiating", "discovering", "capturing", "failed", "cancelled"],
    negotiating: ["discovering", "capturing", "writing", "failed", "cancelled"],
    discovering: ["capturing", "verifying", "paused", "failed", "cancelled"],
    capturing: ["verifying", "paused", "failed", "cancelled"],
    verifying: ["writing", "paused", "failed", "cancelled"],
    writing: ["completed", "paused", "failed", "cancelled"],
    paused: ["discovering", "capturing", "verifying", "writing", "failed", "cancelled"],
    completed: ["writing"],
    failed: ["negotiating", "discovering", "capturing", "verifying", "writing", "cancelled"],
    cancelled: [],
  });

export type PdfManifestPatch = Partial<
  Pick<
    PdfDocumentManifest,
    | "sourceIdentity"
    | "sourceStrategy"
    | "viewerAdapter"
    | "expectedPageCount"
    | "discoveryComplete"
    | "pages"
    | "progress"
    | "outputPlan"
    | "outputState"
    | "lastVerifiedPage"
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

export function canTransitionPdfManifest(from: PdfManifestState, to: PdfManifestState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

function atLeast(page: PdfPageManifest, state: PdfPageLifecycleState): boolean {
  return PAGE_STATE_RANK[page.state] >= PAGE_STATE_RANK[state];
}

export function derivePdfPageProgress(
  pages: readonly PdfPageManifest[],
  expectedPageCount: number | undefined,
  currentBatch: number,
  currentPage?: number,
  outputPages = 0,
): PdfPageProgress {
  return {
    ...(expectedPageCount === undefined ? {} : { expectedPages: expectedPageCount }),
    discoveredPages: pages.length,
    capturedPages: pages.filter((page) => atLeast(page, "captured")).length,
    verifiedPages: pages.filter((page) => atLeast(page, "verified")).length,
    outputPages,
    ...(currentPage === undefined ? {} : { currentPage }),
    currentBatch,
  };
}

function highestVerifiedPage(pages: readonly PdfPageManifest[]): number | undefined {
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index];
    if (page !== undefined && atLeast(page, "verified")) return page.index;
  }
  return undefined;
}

function sameProgress(left: PdfPageProgress, right: PdfPageProgress): boolean {
  return (
    left.expectedPages === right.expectedPages &&
    left.discoveredPages === right.discoveredPages &&
    left.capturedPages === right.capturedPages &&
    left.verifiedPages === right.verifiedPages &&
    left.outputPages === right.outputPages &&
    left.currentPage === right.currentPage &&
    left.currentBatch === right.currentBatch
  );
}

function validateOutputPlan(
  manifest: PdfDocumentManifest,
  plan: PdfOutputPlan,
): Result<void, WebCapErrorData> {
  const unique = new Set(plan.sourcePageIndexes);
  if (unique.size !== plan.sourcePageIndexes.length) {
    return err(
      stateError(
        "PDF output plan cannot contain duplicate source pages.",
        "PdfOutputPlanDuplicate",
        {
          outputPages: plan.sourcePageIndexes.length,
        },
      ),
    );
  }
  for (const pageIndex of plan.sourcePageIndexes) {
    if (pageIndex >= manifest.pages.length) {
      return err(
        stateError(
          "PDF output plan references an unknown source page.",
          "PdfOutputPlanPageMissing",
          {
            pageIndex,
            discoveredPages: manifest.pages.length,
          },
        ),
      );
    }
  }
  if (plan.kind === "source-order") {
    const expected = manifest.expectedPageCount;
    const exactSourceOrder =
      expected !== undefined &&
      plan.sourcePageIndexes.length === expected &&
      plan.sourcePageIndexes.every((pageIndex, position) => pageIndex === position);
    if (!exactSourceOrder) {
      return err(
        stateError(
          "The default PDF output plan must contain every source page in source order.",
          "PdfSourceOutputPlanMismatch",
          {
            expectedPages: expected ?? 0,
            outputPages: plan.sourcePageIndexes.length,
          },
        ),
      );
    }
  }
  if (plan.kind === "editor" && plan.editRevision === undefined) {
    return err(
      stateError("Edited PDF output requires a durable edit revision.", "PdfEditRevisionMissing", {
        outputPages: plan.sourcePageIndexes.length,
      }),
    );
  }
  return ok(undefined);
}

function sameOutputPlan(
  left: PdfOutputPlan | undefined,
  right: PdfOutputPlan | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.kind === right.kind &&
    left.editRevision === right.editRevision &&
    left.sourcePageIndexes.length === right.sourcePageIndexes.length &&
    left.sourcePageIndexes.every((value, index) => value === right.sourcePageIndexes[index])
  );
}

export function validatePdfManifestInvariants(
  manifest: PdfDocumentManifest,
): Result<void, WebCapErrorData> {
  const identities = new Set<string>();
  for (const [position, page] of manifest.pages.entries()) {
    if (page.index !== position) {
      return err(
        stateError(
          "PDF manifest pages must form a contiguous zero-based sequence.",
          "PdfPageIndexGap",
          { expectedIndex: position, actualIndex: page.index },
        ),
      );
    }
    if (identities.has(page.identity)) {
      return err(
        stateError("PDF manifest page identities must be unique.", "PdfPageIdentityDuplicate", {
          pageIndex: page.index,
        }),
      );
    }
    identities.add(page.identity);
  }

  if (
    manifest.expectedPageCount !== undefined &&
    manifest.pages.length > manifest.expectedPageCount
  ) {
    return err(
      stateError("Discovered PDF pages cannot exceed the expected page count.", "PdfPageOverflow", {
        expectedPages: manifest.expectedPageCount,
        discoveredPages: manifest.pages.length,
      }),
    );
  }

  if (
    manifest.discoveryComplete &&
    (manifest.expectedPageCount === undefined ||
      manifest.expectedPageCount !== manifest.pages.length)
  ) {
    return err(
      stateError(
        "Completed PDF discovery requires an exact expected page count.",
        "PdfDiscoveryCountMismatch",
        {
          expectedPages: manifest.expectedPageCount ?? 0,
          discoveredPages: manifest.pages.length,
        },
      ),
    );
  }

  const derivedProgress = derivePdfPageProgress(
    manifest.pages,
    manifest.expectedPageCount,
    manifest.progress.currentBatch,
    manifest.progress.currentPage,
    manifest.progress.outputPages,
  );
  if (!sameProgress(manifest.progress, derivedProgress)) {
    return err(
      stateError(
        "PDF manifest progress must be derived from source page lifecycle state.",
        "PdfProgressDrift",
        {
          discoveredPages: manifest.progress.discoveredPages,
          capturedPages: manifest.progress.capturedPages,
          verifiedPages: manifest.progress.verifiedPages,
          outputPages: manifest.progress.outputPages,
        },
      ),
    );
  }

  const highestVerified = highestVerifiedPage(manifest.pages);
  if (manifest.lastVerifiedPage !== highestVerified) {
    return err(
      stateError("PDF last verified page must match the manifest pages.", "PdfVerifiedPageDrift", {
        lastVerifiedPage: manifest.lastVerifiedPage ?? -1,
        expectedLastVerifiedPage: highestVerified ?? -1,
      }),
    );
  }

  if (
    manifest.progress.currentPage !== undefined &&
    manifest.progress.currentPage >=
      Math.max(manifest.expectedPageCount ?? 0, manifest.pages.length)
  ) {
    return err(
      stateError(
        "PDF current page is outside the known document range.",
        "PdfCurrentPageOutOfRange",
        {
          currentPage: manifest.progress.currentPage,
          knownPages: Math.max(manifest.expectedPageCount ?? 0, manifest.pages.length),
        },
      ),
    );
  }

  if (manifest.outputPlan === undefined) {
    if (
      manifest.progress.outputPages !== 0 ||
      ["writing", "verifying", "completed"].includes(manifest.outputState)
    ) {
      return err(
        stateError("PDF output progress requires a verified output plan.", "PdfOutputPlanMissing", {
          outputPages: manifest.progress.outputPages,
        }),
      );
    }
  } else {
    const planValidation = validateOutputPlan(manifest, manifest.outputPlan);
    if (!planValidation.ok) return planValidation;
    if (manifest.progress.outputPages > manifest.outputPlan.sourcePageIndexes.length) {
      return err(
        stateError(
          "PDF output progress exceeds the verified output plan.",
          "PdfOutputProgressOverflow",
          {
            outputPages: manifest.progress.outputPages,
            plannedPages: manifest.outputPlan.sourcePageIndexes.length,
          },
        ),
      );
    }
    for (const pageIndex of manifest.outputPlan.sourcePageIndexes.slice(
      0,
      manifest.progress.outputPages,
    )) {
      const page = manifest.pages[pageIndex];
      if (page === undefined || !atLeast(page, "written")) {
        return err(
          stateError(
            "Written PDF output progress must correspond to written source pages.",
            "PdfWrittenPageMissing",
            {
              pageIndex,
              outputPages: manifest.progress.outputPages,
            },
          ),
        );
      }
    }
  }

  if (manifest.state === "failed" && manifest.error === undefined) {
    return err(
      stateError("Failed PDF manifests require a normalized error.", "PdfFailureErrorMissing", {
        revision: manifest.revision,
      }),
    );
  }

  if (manifest.state === "completed") {
    const expected = manifest.expectedPageCount;
    const plannedOutputPages = manifest.outputPlan?.sourcePageIndexes.length ?? 0;
    const complete =
      manifest.discoveryComplete &&
      expected !== undefined &&
      expected > 0 &&
      manifest.pages.length === expected &&
      manifest.pages.every((page) => atLeast(page, "verified")) &&
      manifest.progress.discoveredPages === expected &&
      manifest.progress.capturedPages === expected &&
      manifest.progress.verifiedPages === expected &&
      manifest.outputPlan !== undefined &&
      plannedOutputPages > 0 &&
      manifest.progress.outputPages === plannedOutputPages &&
      manifest.outputState === "completed" &&
      manifest.error === undefined;
    if (!complete) {
      return err(
        stateError(
          "A completed PDF manifest requires verified source pages and exact output-plan agreement.",
          "PdfCompletionUnverified",
          {
            expectedPages: expected ?? 0,
            verifiedPages: manifest.progress.verifiedPages,
            plannedOutputPages,
            outputPages: manifest.progress.outputPages,
          },
        ),
      );
    }
  }

  return ok(undefined);
}

function validateMonotonicPages(
  previous: PdfDocumentManifest,
  candidate: PdfDocumentManifest,
): Result<void, WebCapErrorData> {
  if (candidate.pages.length < previous.pages.length) {
    return err(
      stateError("PDF discovery cannot silently remove known pages.", "PdfPagesRegressed", {
        previousPages: previous.pages.length,
        nextPages: candidate.pages.length,
      }),
    );
  }
  if (
    previous.expectedPageCount !== undefined &&
    candidate.expectedPageCount !== undefined &&
    candidate.expectedPageCount < previous.expectedPageCount
  ) {
    return err(
      stateError("Expected PDF page count cannot decrease.", "PdfExpectedPageCountRegressed", {
        previousPages: previous.expectedPageCount,
        nextPages: candidate.expectedPageCount,
      }),
    );
  }
  for (const previousPage of previous.pages) {
    const nextPage = candidate.pages[previousPage.index];
    if (nextPage === undefined || nextPage.identity !== previousPage.identity) {
      return err(
        stateError("Known PDF page identity cannot change in place.", "PdfPageIdentityChanged", {
          pageIndex: previousPage.index,
        }),
      );
    }
    if (PAGE_STATE_RANK[nextPage.state] < PAGE_STATE_RANK[previousPage.state]) {
      return err(
        stateError("PDF page lifecycle state cannot regress.", "PdfPageStateRegressed", {
          pageIndex: previousPage.index,
          previousState: PAGE_STATE_RANK[previousPage.state],
          nextState: PAGE_STATE_RANK[nextPage.state],
        }),
      );
    }
  }
  if (
    previous.outputPlan !== undefined &&
    previous.state !== "completed" &&
    !sameOutputPlan(previous.outputPlan, candidate.outputPlan)
  ) {
    return err(
      stateError("An active PDF output plan cannot change while writing.", "PdfOutputPlanChanged", {
        revision: previous.revision,
      }),
    );
  }
  return ok(undefined);
}

function buildMutation(
  manifest: PdfDocumentManifest,
  updatedAt: string,
  patch: PdfManifestPatch,
  state: PdfManifestState,
): Result<PdfDocumentManifest, WebCapErrorData> {
  const candidate = PdfDocumentManifestSchema.safeParse({
    ...manifest,
    ...patch,
    state,
    revision: manifest.revision + 1,
    updatedAt,
  });
  if (!candidate.success) {
    return err(
      stateError(
        "PDF manifest mutation does not match the domain schema.",
        "InvalidPdfManifestMutation",
        { revision: manifest.revision },
      ),
    );
  }
  const monotonic = validateMonotonicPages(manifest, candidate.data);
  if (!monotonic.ok) return monotonic;
  const invariant = validatePdfManifestInvariants(candidate.data);
  return invariant.ok ? ok(candidate.data) : invariant;
}

export function updatePdfManifest(
  manifest: PdfDocumentManifest,
  updatedAt: string,
  patch: PdfManifestPatch,
): Result<PdfDocumentManifest, WebCapErrorData> {
  return buildMutation(manifest, updatedAt, patch, manifest.state);
}

export function transitionPdfManifest(
  manifest: PdfDocumentManifest,
  nextState: PdfManifestState,
  updatedAt: string,
  patch: PdfManifestPatch = {},
): Result<PdfDocumentManifest, WebCapErrorData> {
  if (!canTransitionPdfManifest(manifest.state, nextState)) {
    return err(
      stateError("PDF manifest transition is not allowed.", "InvalidPdfManifestTransition", {
        from: manifest.state,
        to: nextState,
      }),
    );
  }
  return buildMutation(manifest, updatedAt, patch, nextState);
}
