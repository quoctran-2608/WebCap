import {
  WebCapRuntimeError,
  createWebCapError,
  createWebCapRuntimeError,
} from "@shared/errors/error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

export interface DownloadAdapter {
  download(options: {
    url: string;
    filename: string;
    conflictAction: "uniquify";
    saveAs: boolean;
  }): Promise<number>;
}

export interface ObjectUrlPort {
  createObjectUrl(artifactId: string): Promise<string>;
  revokeObjectUrl(url: string): Promise<boolean>;
}

export interface DownloadServiceOptions {
  artifacts: ArtifactRepositoryPort;
  objectUrls: ObjectUrlPort;
  downloads?: DownloadAdapter;
}

const chromeDownloads: DownloadAdapter = {
  download: (options) => chrome.downloads.download(options),
};

function downloadError(error: unknown, artifactId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_DOWNLOAD_FAILED",
      stage: "export",
      message:
        error instanceof Error && error.message.length > 0
          ? error.message
          : "Chrome could not start the WebCap download.",
      userMessageKey: "errors.downloadFailed",
      retryable: true,
      fallbackAllowed: false,
      safeContext: { artifactId: artifactId.slice(0, 24) },
      causeCode: error instanceof Error ? error.name : "DownloadFailed",
    }),
  );
}

export class DownloadService {
  private readonly artifacts: ArtifactRepositoryPort;
  private readonly objectUrls: ObjectUrlPort;
  private readonly downloads: DownloadAdapter;

  constructor(options: DownloadServiceOptions) {
    this.artifacts = options.artifacts;
    this.objectUrls = options.objectUrls;
    this.downloads = options.downloads ?? chromeDownloads;
  }

  async download(artifactId: string): Promise<number> {
    const artifact = await this.artifacts.get(artifactId);
    if (artifact === undefined || artifact.role !== "output") {
      throw downloadError(new Error("The requested output artifact was not found."), artifactId);
    }

    let objectUrl: string | undefined;
    try {
      objectUrl = await this.objectUrls.createObjectUrl(artifactId);
      return await this.downloads.download({
        url: objectUrl,
        filename: artifact.filename,
        conflictAction: "uniquify",
        saveAs: false,
      });
    } catch (error) {
      if (error instanceof WebCapRuntimeError) {
        throw error;
      }
      throw downloadError(error, artifactId);
    } finally {
      if (objectUrl !== undefined) {
        await this.objectUrls.revokeObjectUrl(objectUrl).catch(() => false);
      }
    }
  }
}
