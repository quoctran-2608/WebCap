import { describe, expect, it } from "vitest";

import {
  CHROME_PDF_VIEWER_EXTENSION_ID,
  contentDispositionFilename,
  contentTypeIsPdf,
  filenameFromPdfUrl,
  hasPdfHeader,
  resolvePdfSourceCandidate,
} from "@background/pdf-source-detection";

describe("PDF source detection", () => {
  it("resolves a public PDF URL without exposing its query in metadata", () => {
    const candidate = resolvePdfSourceCandidate({
      tabId: 4,
      tabUrl: "https://docs.example.test/private/report.pdf?token=secret",
    });

    expect(candidate).toMatchObject({
      tabId: 4,
      scheme: "https",
      sourceLabel: "docs.example.test",
      filename: "report.pdf",
      permissionOrigin: "https://docs.example.test/*",
      urlExtensionSignal: true,
      chromePdfViewerSignal: false,
    });
  });

  it("extracts the original URL from Chrome's built-in PDF viewer", () => {
    const source = encodeURIComponent("https://example.test/manual.pdf?download=1");
    const candidate = resolvePdfSourceCandidate({
      tabId: 8,
      tabUrl: `chrome-extension://${CHROME_PDF_VIEWER_EXTENSION_ID}/index.html?file=${source}`,
    });

    expect(candidate).toMatchObject({
      scheme: "https",
      filename: "manual.pdf",
      chromePdfViewerSignal: true,
      permissionOrigin: "https://example.test/*",
    });
  });

  it("normalizes PDF filenames and content signals", () => {
    expect(filenameFromPdfUrl(new URL("file:///tmp/B%C3%A1o%20c%C3%A1o.pdf"))).toBe("Báo-cáo.pdf");
    expect(contentDispositionFilename("attachment; filename*=UTF-8''quarter%201.pdf")).toBe(
      "quarter-1.pdf",
    );
    expect(contentDispositionFilename('attachment; filename="unsafe/../report"')).toBe(
      "unsafe-report.pdf",
    );
    expect(contentTypeIsPdf("application/pdf; charset=binary")).toBe(true);
    expect(contentTypeIsPdf("text/html")).toBe(false);
  });

  it("accepts a PDF header within the first 1024 bytes only", () => {
    const valid = new Uint8Array(32);
    valid.set(new TextEncoder().encode("%PDF-1.7"), 12);
    expect(hasPdfHeader(valid)).toBe(true);

    const tooLate = new Uint8Array(1040);
    tooLate.set(new TextEncoder().encode("%PDF-1.7"), 1030);
    expect(hasPdfHeader(tooLate)).toBe(false);
  });
});
