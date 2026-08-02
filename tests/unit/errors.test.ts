import { describe, expect, it } from "vitest";

import { createWebCapError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";

describe("error normalization", () => {
  it("returns existing WebCap errors unchanged", () => {
    const existing = createWebCapError({
      code: "E_CANCELLED",
      stage: "capture",
      message: "Capture cancelled.",
      userMessageKey: "errors.cancelled",
    });

    expect(
      normalizeError(existing, {
        stage: "capture",
        userMessageKey: "errors.unknown",
      }),
    ).toEqual(existing);
  });

  it("keeps only a safe bounded error message and cause code", () => {
    const normalized = normalizeError(new TypeError("invalid response"), {
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      userMessageKey: "errors.protocolMessage",
      safeContext: { requestType: "PING" },
    });

    expect(normalized).toMatchObject({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "invalid response",
      causeCode: "TypeError",
      safeContext: { requestType: "PING" },
    });
  });
});
