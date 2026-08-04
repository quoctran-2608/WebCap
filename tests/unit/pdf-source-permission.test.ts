import { describe, expect, it, vi } from "vitest";

import { requestPdfSourcePermission } from "@popup/pdf-source-permission";
import type { PdfSourceCapability } from "@shared/contracts/pdf-source";

function capability(permission: PdfSourceCapability["permission"]): PdfSourceCapability {
  return {
    status: "original-passthrough",
    permission,
    reason: permission === "host-required" ? "permission-missing" : "file-access-disabled",
    tabId: 7,
    scheme: permission === "file-access-required" ? "file" : "https",
    sourceLabel: "example.test",
    filename: "report.pdf",
    permissionOrigin:
      permission === "file-access-required" ? "file:///*" : "https://example.test/*",
    canDownloadOriginal: true,
    canCaptureViewer: true,
    signals: {
      urlExtension: true,
      contentType: false,
      chromePdfViewer: false,
      signature: false,
    },
  };
}

describe("requestPdfSourcePermission", () => {
  it("requests only the exact source origin", async () => {
    const request = vi.fn(() => Promise.resolve(true));
    await expect(
      requestPdfSourcePermission(capability("host-required"), {
        request,
        isFileAccessAllowed: () => Promise.resolve(false),
      }),
    ).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: ["https://example.test/*"] });
  });

  it("requests file origin in the user gesture and verifies Chrome's file-access toggle", async () => {
    const request = vi.fn(() => Promise.resolve(true));
    const isFileAccessAllowed = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(
      requestPdfSourcePermission(capability("file-access-required"), {
        request,
        isFileAccessAllowed,
      }),
    ).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: ["file:///*"] });
    expect(isFileAccessAllowed).toHaveBeenCalledTimes(2);
  });
});
