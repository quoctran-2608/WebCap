import { describe, expect, it } from "vitest";

import { buildCaptureFilename, sanitizeFilenameSegment } from "@background/filename";

describe("filename sanitizer", () => {
  it("normalizes unsafe characters and keeps a deterministic timestamp", () => {
    expect(
      buildCaptureFilename({
        title: '  Báo cáo: Q3 / "North"  ',
        domain: "example.com",
        createdAt: new Date("2026-08-02T11:22:33.000Z"),
        format: "jpeg",
      }),
    ).toBe("Báo-cáo-Q3-North_example.com_2026-08-02_11-22-33.jpg");
  });

  it("removes traversal and falls back for an empty base name", () => {
    expect(sanitizeFilenameSegment("../..\\<>\u0000")).not.toContain("..");
    expect(
      buildCaptureFilename({
        title: "",
        domain: "",
        createdAt: new Date("2026-08-02T00:00:00.000Z"),
        format: "png",
      }),
    ).toBe("2026-08-02_00-00-00.png");
  });

  it("limits the base name to 120 characters", () => {
    const filename = buildCaptureFilename({
      title: "a".repeat(300),
      domain: "example.com",
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      format: "webp",
    });
    expect(filename.replace(/\.webp$/u, "")).toHaveLength(120);
  });
});
