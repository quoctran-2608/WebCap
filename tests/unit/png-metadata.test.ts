import { describe, expect, it } from "vitest";

import { parsePngDataUrl } from "@background/png-metadata";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

describe("parsePngDataUrl", () => {
  it("extracts PNG metadata without decoding the full image", () => {
    const result = parsePngDataUrl(ONE_PIXEL_PNG);

    expect(result).toMatchObject({
      ok: true,
      value: { mimeType: "image/png", width: 1, height: 1 },
    });
    if (result.ok) {
      expect(result.value.byteLength).toBeGreaterThan(0);
    }
  });

  it("rejects an empty or non-PNG capture", () => {
    expect(parsePngDataUrl("data:image/png;base64,")).toMatchObject({
      ok: false,
      error: { code: "E_CAPTURE_EMPTY" },
    });
    expect(parsePngDataUrl("data:image/jpeg;base64,AA==")).toMatchObject({
      ok: false,
      error: { code: "E_CAPTURE_EMPTY" },
    });
  });
});
