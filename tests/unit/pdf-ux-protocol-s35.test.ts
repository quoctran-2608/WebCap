import { describe, expect, it } from "vitest";

import { createSafeDiagnostics } from "@shared/diagnostics";
import {
  PdfManifestGetMessageSchema,
  createJobResumeMessage,
  createPdfManifestGetMessage,
  parsePersistentJobRequest,
} from "@shared/contracts/job-messages";

const sentAt = "2026-08-08T12:00:00.000Z";

describe("S35 PDF UX protocol", () => {
  it("accepts metadata-only PDF manifest reads and resume requests", () => {
    const manifestRequest = createPdfManifestGetMessage({
      requestId: "request-manifest",
      jobId: "job-s35",
      sentAt,
    });
    expect(PdfManifestGetMessageSchema.parse(manifestRequest)).toEqual(manifestRequest);
    expect(parsePersistentJobRequest(manifestRequest)).toMatchObject({ ok: true });

    const resumeRequest = createJobResumeMessage({
      requestId: "request-resume",
      jobId: "job-s35",
      sentAt,
    });
    expect(parsePersistentJobRequest(resumeRequest)).toMatchObject({ ok: true });
    expect(JSON.stringify(resumeRequest)).not.toContain("blob");
  });

  it("allowlists PDF diagnostics instead of copying viewer content", () => {
    const diagnostics = createSafeDiagnostics({
      extensionVersion: "0.2.0",
      locale: "vi",
      surface: "popup",
      pdf: {
        status: "viewer-capture",
        permission: "not-required",
        strategy: "semantic-viewer",
        manifestState: "completed",
        viewerAdapter: "document-title-or-private-viewer-name",
        expectedPages: 126,
        discoveredPages: 126,
        capturedPages: 126,
        verifiedPages: 126,
        outputPages: 126,
        currentBatch: 8,
        verifiedComplete: true,
      },
      generatedAt: sentAt,
    });

    expect(diagnostics.pdf).toEqual({
      status: "viewer-capture",
      permission: "not-required",
      strategy: "semantic-viewer",
      manifestState: "completed",
      viewerAdapterBucket: "other",
      expectedPages: 126,
      discoveredPages: 126,
      capturedPages: 126,
      verifiedPages: 126,
      outputPages: 126,
      currentBatch: 8,
      verification: "verified",
    });
    expect(JSON.stringify(diagnostics)).not.toContain("private-viewer-name");
  });
});
