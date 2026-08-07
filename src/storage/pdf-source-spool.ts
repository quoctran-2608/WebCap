import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

const PDF_SOURCE_SPOOL_DIRECTORY = "webcap-pdf-source";
const STORAGE_RESERVE_BYTES = 16 * 1024 * 1024;

export interface PdfSourceSpoolWriter {
  write(chunk: Uint8Array): Promise<void>;
  close(mimeType: "application/pdf"): Promise<Blob>;
  abort(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface PdfSourceSpoolPort {
  availableBytes(): Promise<number | undefined>;
  create(spoolId: string): Promise<PdfSourceSpoolWriter>;
}

export interface OpfsPdfSourceSpoolOptions {
  getRoot?: () => Promise<FileSystemDirectoryHandle>;
  estimate?: () => Promise<StorageEstimate>;
}

function spoolError(error: unknown): Error {
  const causeCode = error instanceof DOMException ? error.name : undefined;
  const quota = causeCode === "QuotaExceededError";
  return createWebCapRuntimeError(
    createWebCapError({
      code: quota ? "E_STORAGE_QUOTA" : "E_STORAGE_WRITE",
      stage: "storage",
      message: quota
        ? "WebCap does not have enough local storage to spool the original PDF."
        : "WebCap could not write the original PDF to local spool storage.",
      userMessageKey: quota ? "errors.storageQuota" : "errors.storageWrite",
      retryable: !quota,
      fallbackAllowed: true,
      ...(causeCode === undefined ? {} : { causeCode }),
    }),
  );
}

function safeSpoolName(spoolId: string): string {
  const safe = spoolId.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 120);
  return `${safe.length > 0 ? safe : "pdf-source"}.pdf.part`;
}

export class OpfsPdfSourceSpool implements PdfSourceSpoolPort {
  private readonly getRoot: () => Promise<FileSystemDirectoryHandle>;
  private readonly estimate: () => Promise<StorageEstimate>;

  constructor(options: OpfsPdfSourceSpoolOptions = {}) {
    this.getRoot = options.getRoot ?? (() => navigator.storage.getDirectory());
    this.estimate = options.estimate ?? (() => navigator.storage.estimate());
  }

  async availableBytes(): Promise<number | undefined> {
    try {
      const estimate = await this.estimate();
      if (estimate.quota === undefined || estimate.usage === undefined) return undefined;
      return Math.max(0, estimate.quota - estimate.usage - STORAGE_RESERVE_BYTES);
    } catch {
      return undefined;
    }
  }

  async create(spoolId: string): Promise<PdfSourceSpoolWriter> {
    try {
      const root = await this.getRoot();
      const directory = await root.getDirectoryHandle(PDF_SOURCE_SPOOL_DIRECTORY, { create: true });
      const fileName = safeSpoolName(spoolId);
      const handle = await directory.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable({ keepExistingData: false });
      let closed = false;

      const cleanup = async (): Promise<void> => {
        try {
          await directory.removeEntry(fileName);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
        }
      };

      return {
        write: async (chunk) => {
          if (closed) throw new Error("PDF source spool writer is already closed.");
          try {
            await writable.write(chunk);
          } catch (error) {
            throw spoolError(error);
          }
        },
        close: async (mimeType) => {
          if (!closed) {
            try {
              await writable.close();
              closed = true;
            } catch (error) {
              throw spoolError(error);
            }
          }
          try {
            const file = await handle.getFile();
            return file.type === mimeType ? file : new Blob([file], { type: mimeType });
          } catch (error) {
            throw spoolError(error);
          }
        },
        abort: async () => {
          if (!closed) {
            try {
              await writable.abort();
            } finally {
              closed = true;
            }
          }
          await cleanup().catch(() => undefined);
        },
        cleanup: async () => {
          if (!closed) {
            try {
              await writable.close();
            } finally {
              closed = true;
            }
          }
          await cleanup();
        },
      };
    } catch (error) {
      throw spoolError(error);
    }
  }
}
