import { describe, expect, it } from "vitest";

import { ImageProcessor } from "@offscreen/image-processor";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

const source: ArtifactRecord = {
  artifactId: "source-1",
  sourceArtifactId: "source-1",
  jobId: "source-1",
  role: "source",
  format: "png",
  mimeType: "image/png",
  filename: "webcap-source.png",
  byteLength: 3,
  width: 2,
  height: 3,
  createdAt: "2026-08-02T11:00:00.000Z",
  expiresAt: "2026-08-02T11:30:00.000Z",
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
};

describe("ImageProcessor", () => {
  it("encodes, stores, and closes the decoded bitmap", async () => {
    let stored: ArtifactRecord | undefined;
    let closed = false;
    let drawn = false;
    const repository: ArtifactRepositoryPort = {
      put: (record) => {
        stored = record;
        return Promise.resolve();
      },
      get: () => Promise.resolve(source),
      delete: () => Promise.resolve(false),
      deleteExpired: () => Promise.resolve(0),
    };
    const processor = new ImageProcessor({
      artifacts: repository,
      environment: {
        decode: () =>
          Promise.resolve({
            width: 2,
            height: 3,
            close: () => {
              closed = true;
            },
          }),
        createCanvas: () => ({
          getContext: () => ({
            drawImage: () => {
              drawn = true;
            },
          }),
          convertToBlob: (options) =>
            Promise.resolve(new Blob([new Uint8Array([4, 5])], { type: options.type })),
        }),
      },
    });

    await expect(
      processor.process({
        sourceArtifactId: "source-1",
        outputArtifactId: "output-1",
        format: "webp",
        quality: 0.8,
        filename: "capture.webp",
        createdAt: "2026-08-02T11:01:00.000Z",
        expiresAt: "2026-08-02T11:31:00.000Z",
      }),
    ).resolves.toMatchObject({
      artifactId: "output-1",
      mimeType: "image/webp",
      width: 2,
      height: 3,
    });
    expect(drawn).toBe(true);
    expect(closed).toBe(true);
    expect(stored).toMatchObject({ role: "output", byteLength: 2 });
  });
});
