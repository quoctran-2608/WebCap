import { describe, expect, it } from "vitest";

import {
  createSafeDiagnostics,
  serializeSafeDiagnostics,
  type SafeDiagnosticsInput,
} from "@shared/diagnostics";

describe("safe diagnostics", () => {
  it("emits only approved bounded metadata", () => {
    const unsafe = {
      extensionVersion: "0.1.0",
      locale: "en",
      surface: "popup",
      chromeVersion: "Mozilla/5.0 Chrome/151.0.7922.34 Safari/537.36",
      workerStatus: "connected",
      tabStatus: "supported",
      job: {
        id: "1234567890abcdefghijklmnopqrstuvwxyz",
        mode: "full-page",
        state: "failed",
        engine: "scroll",
        completedTiles: 4.9,
        totalTiles: Number.POSITIVE_INFINITY,
        errorCode: "E_LAYOUT_UNSTABLE",
        url: "https://example.test/private",
        title: "secret page title",
        token: "secret",
      },
      image: "data:image/png;base64,secret",
      cookie: "session=secret",
    } as unknown as SafeDiagnosticsInput;

    const document = createSafeDiagnostics({
      ...unsafe,
      generatedAt: "2026-08-04T09:00:00.000Z",
    });
    expect(document).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-08-04T09:00:00.000Z",
      extensionVersion: "0.1.0",
      locale: "en",
      surface: "popup",
      runtime: {
        chromeVersionBucket: "Chromium 151",
        workerStatus: "connected",
        tabStatus: "supported",
      },
      job: {
        id: "1234567890ab",
        mode: "full-page",
        state: "failed",
        engine: "scroll",
        completedTiles: 4,
        errorCode: "E_LAYOUT_UNSTABLE",
      },
    });
    expect(document.job).not.toHaveProperty("totalTiles");
    const json = JSON.stringify(document).toLowerCase();
    for (const forbidden of [
      "example.test",
      "secret",
      "cookie",
      "token",
      "title",
      "image",
      "base64",
      "url",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("serializes stable readable JSON", () => {
    const json = serializeSafeDiagnostics({
      extensionVersion: "0.1.0",
      locale: "vi",
      surface: "editor",
      generatedAt: "2026-08-04T09:00:00.000Z",
    });
    expect(JSON.parse(json)).toEqual({
      schemaVersion: 1,
      generatedAt: "2026-08-04T09:00:00.000Z",
      extensionVersion: "0.1.0",
      locale: "vi",
      surface: "editor",
      runtime: {},
    });
  });
});
