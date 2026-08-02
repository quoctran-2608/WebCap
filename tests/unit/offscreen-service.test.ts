import { describe, expect, it } from "vitest";

import { OffscreenService, type OffscreenRuntimeAdapter } from "@background/offscreen-service";
import {
  createOffscreenImageProcessedMessage,
  createOffscreenReadyMessage,
  isOffscreenPingMessage,
} from "@shared/contracts/offscreen";

const now = new Date("2026-08-02T11:00:00.000Z");

describe("OffscreenService", () => {
  it("deduplicates concurrent document creation and completes the handshake", async () => {
    let exists = false;
    let createCalls = 0;
    const runtime: OffscreenRuntimeAdapter = {
      getUrl: () => "chrome-extension://id/offscreen.html",
      getContexts: () =>
        Promise.resolve(
          exists
            ? [
                {
                  contextType: "OFFSCREEN_DOCUMENT",
                  documentUrl: "chrome-extension://id/offscreen.html",
                },
              ]
            : [],
        ),
      sendMessage: (message) => {
        expect(isOffscreenPingMessage(message)).toBe(true);
        if (!isOffscreenPingMessage(message)) {
          return Promise.reject(new Error("Expected offscreen ping."));
        }
        return Promise.resolve(
          createOffscreenReadyMessage({ requestId: message.requestId, sentAt: now.toISOString() }),
        );
      },
    };
    const service = new OffscreenService({
      runtime,
      offscreen: {
        createDocument: () => {
          createCalls += 1;
          exists = true;
          return Promise.resolve();
        },
        closeDocument: () => Promise.resolve(),
      },
      now: () => now,
      createRequestId: () => "request-ready",
      sleep: () => Promise.resolve(),
      idleTimeoutMs: 60_000,
    });

    await Promise.all([service.ensureDocument(), service.ensureDocument()]);
    expect(createCalls).toBe(1);
  });

  it("validates image-processing responses", async () => {
    const runtime: OffscreenRuntimeAdapter = {
      getUrl: () => "chrome-extension://id/offscreen.html",
      getContexts: () =>
        Promise.resolve([
          {
            contextType: "OFFSCREEN_DOCUMENT",
            documentUrl: "chrome-extension://id/offscreen.html",
          },
        ]),
      sendMessage: (message) => {
        if (isOffscreenPingMessage(message)) {
          return Promise.resolve(
            createOffscreenReadyMessage({
              requestId: message.requestId,
              sentAt: now.toISOString(),
            }),
          );
        }
        const requestId = (message as { requestId: string }).requestId;
        return Promise.resolve(
          createOffscreenImageProcessedMessage({
            requestId,
            sentAt: now.toISOString(),
            artifact: {
              artifactId: "output-1",
              sourceArtifactId: "source-1",
              format: "webp",
              mimeType: "image/webp",
              filename: "capture.webp",
              byteLength: 10,
              width: 10,
              height: 20,
              createdAt: now.toISOString(),
              expiresAt: new Date(now.getTime() + 1_000).toISOString(),
            },
          }),
        );
      },
    };
    const service = new OffscreenService({
      runtime,
      offscreen: {
        createDocument: () => Promise.resolve(),
        closeDocument: () => Promise.resolve(),
      },
      now: () => now,
      createRequestId: () => "request-process",
      idleTimeoutMs: 60_000,
    });

    await expect(
      service.processImage({
        sourceArtifactId: "source-1",
        outputArtifactId: "output-1",
        format: "webp",
        quality: 0.9,
        filename: "capture.webp",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 1_000).toISOString(),
      }),
    ).resolves.toMatchObject({ artifactId: "output-1", mimeType: "image/webp" });
  });
});
