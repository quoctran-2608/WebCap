import { describe, expect, it, vi } from "vitest";

import { routePdfSourceMessage } from "@background/pdf-source-router";
import {
  createPdfSourceDownloadMessage,
  createPdfSourceInspectMessage,
  type PdfSourceCapability,
} from "@shared/contracts/pdf-source";

const now = new Date("2026-08-04T05:00:00.000Z");
const capability: PdfSourceCapability = {
  status: "original-passthrough",
  permission: "granted",
  reason: "url-extension",
  tabId: 7,
  scheme: "https",
  sourceLabel: "example.test",
  filename: "report.pdf",
  permissionOrigin: "https://example.test/*",
  canDownloadOriginal: true,
  canCaptureViewer: true,
  signals: {
    urlExtension: true,
    contentType: false,
    chromePdfViewer: false,
    signature: false,
  },
};

describe("PDF source router", () => {
  it("routes inspection and expected fallback results", async () => {
    const inspect = vi.fn(() => Promise.resolve(capability));
    const downloadOriginal = vi.fn(() =>
      Promise.resolve({
        ...capability,
        status: "auth-required" as const,
        reason: "auth-required" as const,
      }),
    );
    const dependencies = { service: { inspect, downloadOriginal }, now: () => now };

    const inspected = await routePdfSourceMessage(
      createPdfSourceInspectMessage({ requestId: "inspect-1", sentAt: now.toISOString() }),
      dependencies,
    );
    expect(inspected).toMatchObject({
      type: "PDF_SOURCE_INSPECT_RESPONSE",
      payload: { status: "original-passthrough", tabId: 7 },
    });

    const downloaded = await routePdfSourceMessage(
      createPdfSourceDownloadMessage({
        requestId: "download-1",
        expectedTabId: 7,
        sentAt: now.toISOString(),
      }),
      dependencies,
    );
    expect(downloaded).toMatchObject({
      type: "PDF_SOURCE_DOWNLOAD_RESPONSE",
      payload: { status: "fallback", capability: { status: "auth-required" } },
    });
    expect(downloadOriginal).toHaveBeenCalledWith("download-1", 7);
  });

  it("normalizes unexpected failures without source URLs", async () => {
    const response = await routePdfSourceMessage(
      createPdfSourceInspectMessage({ requestId: "inspect-2", sentAt: now.toISOString() }),
      {
        service: {
          inspect: () => Promise.reject(new Error("probe failed")),
          downloadOriginal: () => Promise.reject(new Error("unused")),
        },
        now: () => now,
      },
    );
    expect(response).toMatchObject({
      type: "PDF_SOURCE_ERROR",
      payload: { code: "E_EXPORT_FAILED", fallbackAllowed: true },
    });
    expect(JSON.stringify(response)).not.toContain("https://");
  });
});
