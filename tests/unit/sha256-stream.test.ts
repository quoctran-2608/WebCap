import { describe, expect, it } from "vitest";

import { Sha256Stream } from "@shared/crypto/sha256-stream";

const encoder = new TextEncoder();

describe("Sha256Stream", () => {
  it("matches the standard SHA-256 vector", () => {
    expect(new Sha256Stream().update(encoder.encode("abc")).digestHex()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is chunk-boundary independent", () => {
    const value = encoder.encode("WebCap streamed PDF source acquisition keeps memory bounded.");
    const whole = new Sha256Stream().update(value).digestHex();
    const chunked = new Sha256Stream();
    for (let index = 0; index < value.length; index += 3) {
      chunked.update(value.subarray(index, index + 3));
    }
    expect(chunked.digestHex()).toBe(whole);
  });
});
