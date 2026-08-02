import { describe, expect, it, vi } from "vitest";

import { createArtifactPreview } from "@popup/artifact-preview";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

const record: ArtifactRecord = {
  artifactId: "artifact-1",
  sourceArtifactId: "source-1",
  jobId: "job-1",
  role: "output",
  format: "webp",
  mimeType: "image/webp",
  filename: "capture.webp",
  byteLength: 4,
  width: 2,
  height: 2,
  createdAt: "2026-08-02T09:00:00.000Z",
  expiresAt: "2026-08-02T09:30:00.000Z",
  blob: new Blob(["test"], { type: "image/webp" }),
};

function repository(value: ArtifactRecord | undefined): ArtifactRepositoryPort {
  return {
    put: () => Promise.resolve(),
    get: () => Promise.resolve(value),
    delete: () => Promise.resolve(false),
    deleteExpired: () => Promise.resolve(0),
  };
}

describe("createArtifactPreview", () => {
  it("creates and revokes a local object URL exactly once", async () => {
    const revokeObjectURL = vi.fn();
    const preview = await createArtifactPreview("artifact-1", {
      artifacts: repository(record),
      objectUrls: {
        createObjectURL: () => "blob:webcap-preview",
        revokeObjectURL,
      },
    });

    expect(preview.url).toBe("blob:webcap-preview");
    expect(preview.metadata).toMatchObject({ artifactId: "artifact-1", format: "webp" });

    preview.revoke();
    preview.revoke();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or non-output artifacts", async () => {
    await expect(
      createArtifactPreview("missing", {
        artifacts: repository(undefined),
        objectUrls: {
          createObjectURL: () => "unused",
          revokeObjectURL: () => undefined,
        },
      }),
    ).rejects.toThrow("unavailable");

    await expect(
      createArtifactPreview("source", {
        artifacts: repository({ ...record, role: "source" }),
        objectUrls: {
          createObjectURL: () => "unused",
          revokeObjectURL: () => undefined,
        },
      }),
    ).rejects.toThrow("unavailable");
  });
});
