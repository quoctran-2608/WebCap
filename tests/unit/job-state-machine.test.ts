import { describe, expect, it } from "vitest";

import {
  canTransitionJob,
  isTerminalJobState,
  transitionJob,
  validateJobInvariants,
} from "@background/job-state-machine";
import type { CaptureJob, CaptureTile } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const createdAt = "2026-08-02T16:00:00.000Z";
const updatedAt = "2026-08-02T16:01:00.000Z";
const expiresAt = "2026-08-02T16:30:00.000Z";

function tile(status: CaptureTile["status"] = "planned"): CaptureTile {
  return {
    id: "tile-0",
    jobId: "job-1",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 0, y: 0, width: 100, height: 100 },
    expectedPixelWidth: 100,
    expectedPixelHeight: 100,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    status,
    attempts: 0,
  };
}

function job(state: CaptureJob["state"] = "created"): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { createdAt },
    mode: "full-page",
    preferredEngine: "cdp",
    state,
    stateRevision: 0,
    tilePlan: [],
    completedTiles: 0,
    totalTiles: 0,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: false, completed: false },
    createdAt,
    updatedAt: createdAt,
    expiresAt,
  };
}

describe("job state machine", () => {
  it("applies a valid transition and increments stateRevision", () => {
    const result = transitionJob(job(), "preparing", updatedAt);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        state: "preparing",
        stateRevision: 1,
        updatedAt,
      }),
    });
  });

  it("rejects transitions outside the locked transition table", () => {
    const result = transitionJob(job(), "capturing", updatedAt);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "E_PROTOCOL_MESSAGE", causeCode: "InvalidJobTransition" },
    });
  });

  it("requires an active engine and planned tiles before capturing", () => {
    const result = transitionJob(job("preparing"), "capturing", updatedAt);
    expect(result).toMatchObject({
      ok: false,
      error: { causeCode: "CapturePrerequisitesMissing" },
    });
  });

  it("accepts capturing when engine and tile plan are present", () => {
    const result = transitionJob(job("preparing"), "capturing", updatedAt, {
      activeEngine: "cdp",
      tilePlan: [tile()],
      totalTiles: 1,
    });
    expect(result).toMatchObject({ ok: true, value: { state: "capturing" } });
  });

  it("requires all tiles to be stored before ready", () => {
    const current = {
      ...job("processing"),
      activeEngine: "cdp" as const,
      tilePlan: [tile("capturing")],
      totalTiles: 1,
    };
    const result = transitionJob(current, "ready", updatedAt, { completedTiles: 0 });
    expect(result).toMatchObject({
      ok: false,
      error: { causeCode: "ReadyTilesIncomplete" },
    });
  });

  it("requires source artifact confirmation before exporting", () => {
    const current = {
      ...job("ready"),
      activeEngine: "cdp" as const,
      tilePlan: [tile("stored")],
      completedTiles: 1,
      totalTiles: 1,
    };
    const missing = transitionJob(current, "exporting", updatedAt);
    const present = transitionJob(current, "exporting", updatedAt, {}, {
      sourceArtifactExists: true,
    });
    expect(missing).toMatchObject({
      ok: false,
      error: { causeCode: "SourceArtifactMissing" },
    });
    expect(present).toMatchObject({ ok: true, value: { state: "exporting" } });
  });

  it("requires normalized error and settled cleanup for failed jobs", () => {
    const current = job("preparing");
    const result = transitionJob(current, "failed", updatedAt);
    expect(result).toMatchObject({
      ok: false,
      error: { causeCode: "FailureErrorMissing" },
    });
  });

  it("rejects duplicate tile identifiers", () => {
    const duplicate = { ...tile(), index: 1 };
    const candidate = {
      ...job("processing"),
      tilePlan: [tile(), duplicate],
      totalTiles: 2,
    };
    const result = validateJobInvariants(candidate);
    expect(result).toMatchObject({
      ok: false,
      error: { causeCode: "DuplicateTile" },
    });
  });

  it("marks completed and cancelled as terminal", () => {
    expect(isTerminalJobState("completed")).toBe(true);
    expect(isTerminalJobState("cancelled")).toBe(true);
    expect(isTerminalJobState("failed")).toBe(false);
    expect(canTransitionJob("completed", "exporting")).toBe(false);
  });
});
