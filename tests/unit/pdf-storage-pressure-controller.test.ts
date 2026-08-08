import { describe, expect, it } from "vitest";

import {
  PDF_STORAGE_RESERVE_BYTES,
  PdfStoragePressureController,
} from "@capture/pdf-storage-pressure-controller";

describe("PdfStoragePressureController", () => {
  it("keeps a healthy requested batch when storage has safe headroom", async () => {
    const controller = new PdfStoragePressureController({
      estimate: () =>
        Promise.resolve({
          quota: 256 * 1024 * 1024,
          usage: 32 * 1024 * 1024,
        }),
    });

    await expect(controller.assess(24 * 1024 * 1024, 4 * 1024 * 1024)).resolves.toMatchObject({
      level: "healthy",
      reserveBytes: PDF_STORAGE_RESERVE_BYTES,
      requestedBytes: 24 * 1024 * 1024,
      safeBatchBytes: 24 * 1024 * 1024,
      pauseRequired: false,
    });
  });

  it("shrinks work under pressure without inventing a quota failure", async () => {
    const controller = new PdfStoragePressureController({
      reserveBytes: 16,
      estimate: () => Promise.resolve({ quota: 116, usage: 40 }),
    });

    await expect(controller.assess(50, 20)).resolves.toEqual({
      level: "pressure",
      reserveBytes: 16,
      requestedBytes: 50,
      minimumProgressBytes: 20,
      availableBytes: 60,
      quotaBytes: 116,
      usageBytes: 40,
      safeBatchBytes: 50,
      pauseRequired: false,
    });
  });

  it("requires a pause when one complete logical page cannot fit safely", async () => {
    const controller = new PdfStoragePressureController({
      reserveBytes: 16,
      estimate: () => Promise.resolve({ quota: 100, usage: 70 }),
    });

    await expect(controller.assess(40, 20)).resolves.toMatchObject({
      level: "critical",
      availableBytes: 14,
      safeBatchBytes: 14,
      pauseRequired: true,
    });
  });

  it("treats unavailable estimates as unknown rather than false quota exhaustion", async () => {
    const controller = new PdfStoragePressureController({
      estimate: () => Promise.reject(new Error("estimate unavailable")),
    });

    await expect(controller.assess(100, 25)).resolves.toMatchObject({
      level: "unknown",
      pauseRequired: false,
    });
  });
});
