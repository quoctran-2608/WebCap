import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

export interface ObjectUrlEnvironment {
  create(blob: Blob): string;
  revoke(url: string): void;
  setTimer(callback: () => void, milliseconds: number): number;
  clearTimer(timerId: number): void;
}

export interface ObjectUrlRegistryOptions {
  artifacts: ArtifactRepositoryPort;
  environment?: ObjectUrlEnvironment;
  ttlMs?: number;
}

interface ActiveObjectUrl {
  timerId: number;
}

const DEFAULT_OBJECT_URL_TTL_MS = 60_000;

const defaultEnvironment: ObjectUrlEnvironment = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
  setTimer: (callback, milliseconds) =>
    globalThis.setTimeout(callback, milliseconds) as unknown as number,
  clearTimer: (timerId) => {
    globalThis.clearTimeout(timerId);
  },
};

function missingArtifactError(artifactId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The requested WebCap artifact is not available.",
      userMessageKey: "errors.storageRead",
      retryable: false,
      fallbackAllowed: false,
      safeContext: { artifactId: artifactId.slice(0, 24) },
    }),
  );
}

export class ObjectUrlRegistry {
  private readonly artifacts: ArtifactRepositoryPort;
  private readonly environment: ObjectUrlEnvironment;
  private readonly ttlMs: number;
  private readonly active = new Map<string, ActiveObjectUrl>();

  constructor(options: ObjectUrlRegistryOptions) {
    this.artifacts = options.artifacts;
    this.environment = options.environment ?? defaultEnvironment;
    this.ttlMs = options.ttlMs ?? DEFAULT_OBJECT_URL_TTL_MS;
  }

  async create(artifactId: string): Promise<string> {
    const artifact = await this.artifacts.get(artifactId);
    if (artifact === undefined) {
      throw missingArtifactError(artifactId);
    }

    const url = this.environment.create(artifact.blob);
    const timerId = this.environment.setTimer(() => {
      this.revoke(url);
    }, this.ttlMs);
    this.active.set(url, { timerId });
    return url;
  }

  revoke(url: string): boolean {
    const current = this.active.get(url);
    if (current === undefined) {
      return false;
    }

    this.environment.clearTimer(current.timerId);
    this.environment.revoke(url);
    this.active.delete(url);
    return true;
  }
}
