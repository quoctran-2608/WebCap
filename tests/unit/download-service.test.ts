import { describe, expect, it } from "vitest";

import { DownloadService } from "@background/download-service";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

const artifact: ArtifactRecord = {
  artifactId: "output-1",
  sourceArtifactId: "source-1",
  jobId: "source-1",
  role: "output",
  format: "png",
  mimeType: "image/png",
  filename: "capture.png",
  byteLength: 3,
  width: 1,
  height: 1,
  createdAt: "2026-08-02T11:00:00.000Z",
  expiresAt: "2026-08-02T11:30:00.000Z",
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
};

const repository = (record: ArtifactRecord | undefined): ArtifactRepositoryPort => ({
  put: () => Promise.resolve(),
  get: () => Promise.resolve(record),
  delete: () => Promise.resolve(false),
  deleteExpired: () => Promise.resolve(0),
});

describe("DownloadService", () => {
  it("starts a download and revokes the object URL", async () => {
    const events: string[] = [];
    const service = new DownloadService({
      artifacts: repository(artifact),
      objectUrls: {
        createObjectUrl: () => {
          events.push("create");
          return Promise.resolve("blob:artifact");
        },
        revokeObjectUrl: () => {
          events.push("revoke");
          return Promise.resolve(true);
        },
      },
      downloads: {
        download: (options) => {
          events.push(`download:${options.filename}`);
          return Promise.resolve(42);
        },
      },
    });

    await expect(service.download("output-1")).resolves.toBe(42);
    expect(events).toEqual(["create", "download:capture.png", "revoke"]);
  });

  it("preserves normalized offscreen errors", async () => {
    const service = new DownloadService({
      artifacts: repository(artifact),
      objectUrls: {
        createObjectUrl: () =>
          Promise.reject(
            createWebCapRuntimeError(
              createWebCapError({
                code: "E_OFFSCREEN_UNAVAILABLE",
                stage: "process",
                message: "offscreen unavailable",
                userMessageKey: "errors.offscreenUnavailable",
                retryable: true,
                fallbackAllowed: false,
              }),
            ),
          ),
        revokeObjectUrl: () => Promise.resolve(false),
      },
      downloads: {
        download: () => Promise.resolve(1),
      },
    });

    await expect(service.download("output-1")).rejects.toMatchObject({
      code: "E_OFFSCREEN_UNAVAILABLE",
      stage: "process",
    });
  });

  it("revokes the object URL when Chrome download fails", async () => {
    let revoked = false;
    const service = new DownloadService({
      artifacts: repository(artifact),
      objectUrls: {
        createObjectUrl: () => Promise.resolve("blob:artifact"),
        revokeObjectUrl: () => {
          revoked = true;
          return Promise.resolve(true);
        },
      },
      downloads: {
        download: () => Promise.reject(new Error("download rejected")),
      },
    });

    await expect(service.download("output-1")).rejects.toMatchObject({
      code: "E_DOWNLOAD_FAILED",
      retryable: true,
    });
    expect(revoked).toBe(true);
  });
});
