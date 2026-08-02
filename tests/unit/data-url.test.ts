import { describe, expect, it } from "vitest";

import { dataUrlToBlob } from "@background/data-url";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

describe("dataUrlToBlob", () => {
  it("converts capture base64 into a typed Blob", () => {
    const blob = dataUrlToBlob(ONE_PIXEL_PNG);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("rejects malformed capture data", () => {
    expect(() => dataUrlToBlob("data:image/png,not-base64")).toThrowError(
      expect.objectContaining({ name: "E_CAPTURE_EMPTY" }),
    );
  });
});
