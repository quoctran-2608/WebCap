import { describe, expect, it, vi } from "vitest";

import type { OffscreenService } from "@background/offscreen-service";
import type { DownloadService } from "@background/download-service";
import { ImageExportService } from "@background/image-export-service";
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
  width: 1,
  height: 1,
  createdAt: "2026-08-02T11:00:00.000Z",
  expiresAt: "2026-08-02T11:30:00.000Z",
  sourceTitle: "Quarterly Report",
  sourceDomain: "example.com",
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
};

const repository: ArtifactRepositoryPort = {
  put: () => Promise.resolve(),
  get: (artifactId) => Promise.resolve(artifactId === source.artifactId ? source : undefined),
  delete: () => Promise.resolve(false),
  deleteExpired: () => Promise.resolve(0),
};

describe("ImageExportService", () => {
  it("deduplicates a request and retries from the durable source artifact", async () => {
    let processCalls = 0;
    const now = new Date("2026-08-02T11:22:33.000Z");
    const offscreen = {
      processImage: (options: {
        sourceArtifactId: string;
        outputArtifactId: string;
        format: "png" | "jpeg" | "webp";
        quality: number;
        filename: string;
        createdAt: string;
        expiresAt: string;
      }) => {
        processCalls += 1;
        return Promise.resolve({
          artifactId: options.outputArtifactId,
          sourceArtifactId: options.sourceArtifactId,
          format: options.format,
          mimeType: options.format === "jpeg" ? "image/jpeg" : "image/png",
          filename: options.filename,
          byteLength: 10,
          width: 1,
          height: 1,
          createdAt: options.createdAt,
          expiresAt: options.expiresAt,
        } as const);
      },
    } as OffscreenService;
    const service = new ImageExportService({
      artifacts: repository,
      offscreen,
      downloads: { download: () => Promise.resolve(1) } as unknown as DownloadService,
      now: () => now,
      createId: () => `output-${processCalls + 1}`,
    });

    const first = service.exportCapture({
      requestId: "request-1",
      sourceArtifactId: "source-1",
      format: "jpeg",
      quality: 0.9,
    });
    const duplicate = service.exportCapture({
      requestId: "request-1",
      sourceArtifactId: "source-1",
      format: "jpeg",
      quality: 0.9,
    });

    expect(duplicate).toBe(first);
    await expect(first).resolves.toMatchObject({
      sourceArtifactId: "source-1",
      filename: "Quarterly-Report_example.com_2026-08-02_11-22-33.jpg",
    });
    expect(processCalls).toBe(1);

    await service.exportCapture({
      requestId: "request-2",
      sourceArtifactId: "source-1",
      format: "png",
      quality: 1,
    });
    expect(processCalls).toBe(2);
  });

  it("surfaces storage failure without requesting a new capture", async () => {
    const service = new ImageExportService({
      artifacts: {
        ...repository,
        get: () => Promise.reject(Object.assign(new Error("quota"), { name: "E_STORAGE_QUOTA" })),
      },
      offscreen: {} as OffscreenService,
      downloads: {} as DownloadService,
    });

    await expect(
      service.exportCapture({
        requestId: "request-quota",
        sourceArtifactId: "source-1",
        format: "png",
        quality: 1,
      }),
    ).rejects.toThrow("quota");
  });
  it("deletes an output that finishes after its source was reset", async () => {
    let resolveProcessing!: (value: {
      artifactId: string;
      sourceArtifactId: string;
      format: "png";
      mimeType: "image/png";
      filename: string;
      byteLength: number;
      width: number;
      height: number;
      createdAt: string;
      expiresAt: string;
    }) => void;
    const deleted: string[] = [];
    const service = new ImageExportService({
      artifacts: {
        ...repository,
        delete: (artifactId) => {
          deleted.push(artifactId);
          return Promise.resolve(true);
        },
      },
      offscreen: {
        processImage: (options: {
          sourceArtifactId: string;
          outputArtifactId: string;
          filename: string;
          createdAt: string;
          expiresAt: string;
        }) =>
          new Promise((resolve) => {
            resolveProcessing = () =>
              resolve({
                artifactId: options.outputArtifactId,
                sourceArtifactId: options.sourceArtifactId,
                format: "png",
                mimeType: "image/png",
                filename: options.filename,
                byteLength: 10,
                width: 1,
                height: 1,
                createdAt: options.createdAt,
                expiresAt: options.expiresAt,
              });
          }),
      } as unknown as OffscreenService,
      downloads: {} as DownloadService,
      createId: () => "late-output",
    });

    const exportPromise = service.exportCapture({
      requestId: "late-request",
      sourceArtifactId: "source-1",
      format: "png",
      quality: 1,
    });
    await vi.waitFor(() => expect(resolveProcessing).toBeTypeOf("function"));
    const cancelPromise = service.cancelBySourceArtifactId("source-1");
    resolveProcessing({} as never);

    await cancelPromise;
    await expect(exportPromise).rejects.toMatchObject({ name: "E_CANCELLED" });
    expect(deleted).toContain("late-output");
  });
});
