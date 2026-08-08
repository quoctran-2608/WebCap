import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

const PDF_OUTPUT_SPOOL_DIRECTORY = "webcap-pdf-output";
const STORAGE_RESERVE_BYTES = 16 * 1024 * 1024;
const PDF_REFERENCE_PREFIX = `${PDF_OUTPUT_SPOOL_DIRECTORY}/`;

export interface PdfSpoolFile {
  reference: string;
  byteLength: number;
  mimeType: "application/pdf" | "image/jpeg";
  blob: Blob;
}

export interface PdfSpoolWritable {
  readonly reference: string;
  readonly byteLength: number;
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<PdfSpoolFile>;
  abort(): Promise<void>;
}

export interface PdfOutputSpoolPort {
  availableBytes(): Promise<number | undefined>;
  createOutput(outputArtifactId: string): Promise<PdfSpoolWritable>;
  writeRasterPage(outputArtifactId: string, pageIndex: number, blob: Blob): Promise<PdfSpoolFile>;
  read(reference: string): Promise<Blob>;
  delete(reference: string): Promise<void>;
}

export interface OpfsPdfOutputSpoolOptions {
  getRoot?: () => Promise<FileSystemDirectoryHandle>;
  estimate?: () => Promise<StorageEstimate>;
}

function safeName(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 120);
  return safe.length > 0 ? safe : "pdf-output";
}

function outputFileName(outputArtifactId: string): string {
  return `${safeName(outputArtifactId)}.pdf`;
}

function rasterFileName(outputArtifactId: string, pageIndex: number): string {
  const page = Math.max(0, Math.floor(pageIndex)).toString().padStart(6, "0");
  return `${safeName(outputArtifactId)}.page-${page}.jpg`;
}

function referenceFor(fileName: string): string {
  return `${PDF_REFERENCE_PREFIX}${fileName}`;
}

function fileNameFromReference(reference: string): string {
  if (!reference.startsWith(PDF_REFERENCE_PREFIX)) {
    throw spoolError(new DOMException("Invalid PDF spool reference.", "DataError"));
  }
  const fileName = reference.slice(PDF_REFERENCE_PREFIX.length);
  if (
    fileName.length === 0 ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName === "." ||
    fileName === ".."
  ) {
    throw spoolError(new DOMException("Invalid PDF spool reference.", "DataError"));
  }
  return fileName;
}

function causeCode(error: unknown): string | undefined {
  return error instanceof DOMException ? error.name : undefined;
}

function spoolError(error: unknown): Error {
  const cause = causeCode(error);
  const quota = cause === "QuotaExceededError";
  const unsupported =
    cause === "NotSupportedError" ||
    cause === "SecurityError" ||
    cause === "InvalidStateError" ||
    cause === "UnknownError";
  return createWebCapRuntimeError(
    createWebCapError({
      code: quota ? "E_STORAGE_QUOTA" : "E_STORAGE_WRITE",
      stage: "storage",
      message: quota
        ? "WebCap does not have enough local storage for the streamed PDF output."
        : "WebCap could not use local disk spool storage for PDF output.",
      userMessageKey: quota ? "errors.storageQuota" : "errors.storageWrite",
      retryable: !quota,
      fallbackAllowed: unsupported,
      ...(cause === undefined ? {} : { causeCode: cause }),
    }),
  );
}

function ownedArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  return copy.buffer;
}

function mimeTypeForFileName(fileName: string): "application/pdf" | "image/jpeg" {
  return fileName.endsWith(".jpg") ? "image/jpeg" : "application/pdf";
}

export function isPdfSpoolFallbackAllowed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    (error as { data?: { fallbackAllowed?: unknown } }).data?.fallbackAllowed === true
  );
}

export class OpfsPdfOutputSpool implements PdfOutputSpoolPort {
  private readonly getRoot: () => Promise<FileSystemDirectoryHandle>;
  private readonly estimate: () => Promise<StorageEstimate>;

  constructor(options: OpfsPdfOutputSpoolOptions = {}) {
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

  async createOutput(outputArtifactId: string): Promise<PdfSpoolWritable> {
    try {
      const root = await this.getRoot();
      const directory = await root.getDirectoryHandle(PDF_OUTPUT_SPOOL_DIRECTORY, { create: true });
      const fileName = outputFileName(outputArtifactId);
      const reference = referenceFor(fileName);
      const handle = await directory.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable({ keepExistingData: false });
      let bytes = 0;
      let closed = false;

      const remove = async (): Promise<void> => {
        try {
          await directory.removeEntry(fileName);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
        }
      };

      return {
        reference,
        get byteLength() {
          return bytes;
        },
        write: async (chunk) => {
          if (closed) throw spoolError(new DOMException("PDF output spool is closed.", "InvalidStateError"));
          try {
            await writable.write(ownedArrayBuffer(chunk));
            bytes += chunk.byteLength;
          } catch (error) {
            throw spoolError(error);
          }
        },
        close: async () => {
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
            const blob = file.slice(0, file.size, "application/pdf");
            return {
              reference,
              byteLength: file.size,
              mimeType: "application/pdf",
              blob,
            };
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
          await remove().catch(() => undefined);
        },
      };
    } catch (error) {
      throw spoolError(error);
    }
  }

  async writeRasterPage(
    outputArtifactId: string,
    pageIndex: number,
    blob: Blob,
  ): Promise<PdfSpoolFile> {
    try {
      const root = await this.getRoot();
      const directory = await root.getDirectoryHandle(PDF_OUTPUT_SPOOL_DIRECTORY, { create: true });
      const fileName = rasterFileName(outputArtifactId, pageIndex);
      const handle = await directory.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable({ keepExistingData: false });
      try {
        await writable.write(blob);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
      const file = await handle.getFile();
      return {
        reference: referenceFor(fileName),
        byteLength: file.size,
        mimeType: "image/jpeg",
        blob: file.slice(0, file.size, "image/jpeg"),
      };
    } catch (error) {
      throw spoolError(error);
    }
  }

  async read(reference: string): Promise<Blob> {
    try {
      const root = await this.getRoot();
      const directory = await root.getDirectoryHandle(PDF_OUTPUT_SPOOL_DIRECTORY);
      const fileName = fileNameFromReference(reference);
      const handle = await directory.getFileHandle(fileName);
      const file = await handle.getFile();
      return file.slice(0, file.size, mimeTypeForFileName(fileName));
    } catch (error) {
      throw spoolError(error);
    }
  }

  async delete(reference: string): Promise<void> {
    try {
      const root = await this.getRoot();
      const directory = await root.getDirectoryHandle(PDF_OUTPUT_SPOOL_DIRECTORY, { create: true });
      const fileName = fileNameFromReference(reference);
      await directory.removeEntry(fileName);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return;
      throw spoolError(error);
    }
  }
}
