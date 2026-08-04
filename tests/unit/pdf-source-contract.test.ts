import { describe, expect, it } from "vitest";

import {
  PdfSourceCapabilitySchema,
  createPdfSourceDownloadMessage,
  createPdfSourceInspectMessage,
  parsePdfSourceRequest,
} from "@shared/contracts/pdf-source";

const sentAt = "2026-08-04T05:00:00.000Z";

describe("PDF source contracts", () => {
  it("creates metadata-only inspect and download requests", () => {
    const inspect = createPdfSourceInspectMessage({ requestId: "inspect-1", sentAt });
    const download = createPdfSourceDownloadMessage({
      requestId: "download-1",
      expectedTabId: 7,
      sentAt,
    });

    expect(parsePdfSourceRequest(inspect).ok).toBe(true);
    expect(parsePdfSourceRequest(download).ok).toBe(true);
    expect(JSON.stringify([inspect, download])).not.toContain("blob");
    expect(JSON.stringify([inspect, download])).not.toContain("https://");
  });

  it("rejects full source URLs from capability metadata", () => {
    const parsed = PdfSourceCapabilitySchema.safeParse({
      status: "original-passthrough",
      permission: "host-required",
      reason: "permission-missing",
      tabId: 7,
      scheme: "https",
      sourceLabel: "example.com",
      filename: "report.pdf",
      permissionOrigin: "https://example.com/*",
      sourceUrl: "https://example.com/private/report.pdf?token=secret",
      canDownloadOriginal: true,
      canCaptureViewer: true,
      signals: {
        urlExtension: true,
        contentType: false,
        chromePdfViewer: false,
        signature: false,
      },
    });

    expect(parsed.success).toBe(false);
  });
});
