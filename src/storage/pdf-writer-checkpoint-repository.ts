import { z } from "zod";

import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

const PDF_WRITER_DB = "webcap-pdf-writer-db";
const PDF_WRITER_DB_VERSION = 1;
const PDF_WRITER_STORE = "writerCheckpoints";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const PdfWriterCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: z.string().min(1).max(160),
    outputArtifactId: z.string().min(1).max(160),
    spoolReference: z.string().min(1).max(300),
    pagesWritten: z.number().int().nonnegative(),
    totalPages: z.number().int().positive(),
    byteLength: z.number().int().nonnegative(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

export type PdfWriterCheckpoint = z.infer<typeof PdfWriterCheckpointSchema>;

export interface PdfWriterCheckpointRepositoryPort {
  get(jobId: string): Promise<PdfWriterCheckpoint | undefined>;
  put(checkpoint: PdfWriterCheckpoint): Promise<void>;
  delete(jobId: string): Promise<boolean>;
}

export interface IndexedDbPdfWriterCheckpointRepositoryOptions {
  openDatabase?: () => Promise<IDBDatabase>;
}

function storageError(operation: "read" | "write", error: unknown): Error {
  const causeCode = error instanceof DOMException ? error.name : undefined;
  const quota = causeCode === "QuotaExceededError";
  return createWebCapRuntimeError(
    createWebCapError({
      code: quota ? "E_STORAGE_QUOTA" : operation === "read" ? "E_STORAGE_READ" : "E_STORAGE_WRITE",
      stage: "storage",
      message: quota
        ? "WebCap local storage quota was exceeded while checkpointing PDF output."
        : `WebCap could not ${operation} the PDF writer checkpoint.`,
      userMessageKey: quota
        ? "errors.storageQuota"
        : operation === "read"
          ? "errors.storageRead"
          : "errors.storageWrite",
      retryable: !quota,
      fallbackAllowed: false,
      ...(causeCode === undefined ? {} : { causeCode }),
    }),
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

export async function openPdfWriterCheckpointDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_WRITER_DB, PDF_WRITER_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PDF_WRITER_STORE)) {
        database.createObjectStore(PDF_WRITER_STORE, { keyPath: "jobId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open PDF writer database."));
    request.onblocked = () => reject(new Error("PDF writer database upgrade was blocked."));
  });
}

function parseCheckpoint(value: unknown): PdfWriterCheckpoint {
  const parsed = PdfWriterCheckpointSchema.safeParse(value);
  if (!parsed.success) {
    throw storageError("read", new DOMException("Invalid PDF writer checkpoint.", "DataError"));
  }
  return parsed.data;
}

export class IndexedDbPdfWriterCheckpointRepository implements PdfWriterCheckpointRepositoryPort {
  private readonly openDatabase: () => Promise<IDBDatabase>;

  constructor(options: IndexedDbPdfWriterCheckpointRepositoryOptions = {}) {
    this.openDatabase = options.openDatabase ?? openPdfWriterCheckpointDatabase;
  }

  async get(jobId: string): Promise<PdfWriterCheckpoint | undefined> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(PDF_WRITER_STORE, "readonly");
      const value = await requestResult<unknown>(
        transaction.objectStore(PDF_WRITER_STORE).get(jobId),
      );
      return value === undefined ? undefined : parseCheckpoint(value);
    } catch (error) {
      throw storageError("read", error);
    }
  }

  async put(checkpoint: PdfWriterCheckpoint): Promise<void> {
    const validated = PdfWriterCheckpointSchema.parse(checkpoint);
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(PDF_WRITER_STORE, "readwrite");
      const completed = transactionDone(transaction);
      transaction.objectStore(PDF_WRITER_STORE).put(validated);
      await completed;
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async delete(jobId: string): Promise<boolean> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(PDF_WRITER_STORE, "readwrite");
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(PDF_WRITER_STORE);
      const existing = await requestResult<unknown>(store.get(jobId));
      if (existing === undefined) {
        await completed;
        return false;
      }
      store.delete(jobId);
      await completed;
      return true;
    } catch (error) {
      throw storageError("write", error);
    }
  }
}
