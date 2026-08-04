import { describe, expect, it } from "vitest";

import {
  CaptureResetReportSchema,
  createCaptureResetRequest,
  createCaptureResetResponse,
  isCaptureResetResponse,
  parseCaptureResetRequest,
} from "@shared/contracts/capture-reset";

const sentAt = "2026-08-04T15:00:00.000Z";

describe("capture reset contract", () => {
  it("creates strict job, visible-session, and tab reset requests", () => {
    expect(
      createCaptureResetRequest({
        requestId: "reset-job",
        sentAt,
        scope: "job",
        jobId: "job-1",
      }),
    ).toMatchObject({
      type: "CAPTURE_RESET",
      payload: { scope: "job", jobId: "job-1", disposition: "discard-local-data" },
    });
    expect(
      createCaptureResetRequest({
        requestId: "reset-visible",
        sentAt,
        scope: "visible-session",
      }),
    ).toMatchObject({ payload: { scope: "visible-session" } });
    expect(
      createCaptureResetRequest({
        requestId: "reset-tab",
        sentAt,
        scope: "tab",
        tabId: 7,
      }),
    ).toMatchObject({ payload: { scope: "tab", tabId: 7 } });
  });

  it("rejects ambiguous or invalid reset identity", () => {
    const parsed = parseCaptureResetRequest({
      protocolVersion: 1,
      requestId: "bad",
      source: "popup",
      target: "background",
      type: "CAPTURE_RESET",
      payload: { scope: "job", disposition: "discard-local-data" },
      sentAt,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("E_PROTOCOL_MESSAGE");
  });

  it("round-trips a metadata-only reset response", () => {
    const report = CaptureResetReportSchema.parse({
      schemaVersion: 1,
      scope: "job",
      jobId: "job-1",
      tabId: 7,
      cancellationAttempted: true,
      cancellationCompleted: true,
      deletedJobs: 1,
      deletedTiles: 4,
      deletedArtifacts: 3,
      deletedManifests: 1,
      clearedSessions: 1,
    });
    const response = createCaptureResetResponse({
      requestId: "reset-job",
      target: "popup",
      report,
      sentAt,
    });
    expect(isCaptureResetResponse(response)).toBe(true);
    expect(JSON.stringify(response)).not.toContain("blob");
    expect(JSON.stringify(response)).not.toContain("http");
  });
});
