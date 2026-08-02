import { describe, expect, it } from "vitest";

import { estimateOutputBytes, formatBytes } from "@popup/formatting";

describe("popup output formatting", () => {
  it("formats bytes without exposing imprecise long values", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1_536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.00 MB");
  });

  it("uses conservative format estimates", () => {
    expect(estimateOutputBytes(1_000, "png")).toBe(1_000);
    expect(estimateOutputBytes(1_000, "jpeg")).toBe(580);
    expect(estimateOutputBytes(1_000, "webp")).toBe(460);
  });
});
