import {
  PdfEditManifestSchema,
  type PdfEditManifest,
} from "@shared/contracts/pdf-editor";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

const STORAGE_PREFIX = "webcap.pdf-edit.";

export interface PdfEditStorageAdapter {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PdfEditManifestRepositoryPort {
  load(jobId: string): Promise<PdfEditManifest | undefined>;
  save(manifest: PdfEditManifest): Promise<void>;
  delete(jobId: string): Promise<void>;
}

export const chromePdfEditStorageAdapter: PdfEditStorageAdapter = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
  remove: (key) => chrome.storage.local.remove(key),
};

function keyFor(jobId: string): string {
  return `${STORAGE_PREFIX}${jobId}`;
}

function storageError(operation: "read" | "write", cause: unknown): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: operation === "read" ? "E_STORAGE_READ" : "E_STORAGE_WRITE",
      stage: "storage",
      message:
        operation === "read"
          ? "WebCap could not read the PDF edit manifest."
          : "WebCap could not save the PDF edit manifest.",
      userMessageKey: operation === "read" ? "errors.storageRead" : "errors.storageWrite",
      retryable: true,
      fallbackAllowed: false,
      causeCode: cause instanceof Error ? cause.name : "PdfEditStorageFailure",
    }),
  );
}

export class PdfEditManifestRepository implements PdfEditManifestRepositoryPort {
  constructor(private readonly storage: PdfEditStorageAdapter = chromePdfEditStorageAdapter) {}

  async load(jobId: string): Promise<PdfEditManifest | undefined> {
    const key = keyFor(jobId);
    try {
      const result = await this.storage.get(key);
      const value = result[key];
      if (value === undefined) return undefined;
      const parsed = PdfEditManifestSchema.safeParse(value);
      if (!parsed.success) {
        throw createWebCapRuntimeError(
          createWebCapError({
            code: "E_STORAGE_READ",
            stage: "storage",
            message: "The stored PDF edit manifest is invalid.",
            userMessageKey: "errors.storageRead",
            retryable: true,
            fallbackAllowed: false,
            causeCode: "InvalidPdfEditManifest",
            safeContext: { jobId: jobId.slice(0, 24) },
          }),
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof Error && "code" in error) throw error;
      throw storageError("read", error);
    }
  }

  async save(manifest: PdfEditManifest): Promise<void> {
    const parsed = PdfEditManifestSchema.parse(manifest);
    try {
      await this.storage.set({ [keyFor(parsed.jobId)]: parsed });
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async delete(jobId: string): Promise<void> {
    try {
      await this.storage.remove(keyFor(jobId));
    } catch (error) {
      throw storageError("write", error);
    }
  }
}
