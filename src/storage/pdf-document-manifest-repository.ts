import { PdfDocumentManifestSchema, type PdfDocumentManifest } from "@shared/contracts/pdf-capture";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

import { requestResult, storageError, transactionDone } from "./indexeddb-helpers";
import { openPdfDocumentDatabase, PDF_DOCUMENT_STORE } from "./pdf-document-database";

export interface PdfDocumentManifestRepositoryPort {
  create(manifest: PdfDocumentManifest): Promise<void>;
  get(jobId: string): Promise<PdfDocumentManifest | undefined>;
  save(manifest: PdfDocumentManifest, expectedRevision: number): Promise<void>;
  delete(jobId: string): Promise<boolean>;
  listExpired(nowIso: string): Promise<PdfDocumentManifest[]>;
}

export interface IndexedDbPdfDocumentManifestRepositoryOptions {
  openDatabase?: () => Promise<IDBDatabase>;
}

function revisionConflict(
  jobId: string,
  expectedRevision: number,
  actualRevision: number | "missing" | "invalid-next-revision",
): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_WRITE",
      stage: "storage",
      message: "A newer PDF document manifest revision already exists.",
      userMessageKey: "errors.jobRevisionConflict",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "PdfManifestRevisionConflict",
      safeContext: { jobId: jobId.slice(0, 24), expectedRevision, actualRevision },
    }),
  );
}

function parseManifest(value: unknown): PdfDocumentManifest {
  const parsed = PdfDocumentManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_STORAGE_READ",
        stage: "storage",
        message: "Stored PDF document manifest does not match the current schema.",
        userMessageKey: "errors.jobStorageInvalid",
        retryable: false,
        fallbackAllowed: false,
        causeCode: "InvalidPdfDocumentManifestRecord",
      }),
    );
  }
  return parsed.data;
}

export class IndexedDbPdfDocumentManifestRepository implements PdfDocumentManifestRepositoryPort {
  private readonly openDatabase: () => Promise<IDBDatabase>;

  constructor(options: IndexedDbPdfDocumentManifestRepositoryOptions = {}) {
    this.openDatabase = options.openDatabase ?? (() => openPdfDocumentDatabase());
  }

  async create(manifest: PdfDocumentManifest): Promise<void> {
    const validated = PdfDocumentManifestSchema.parse(manifest);
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(PDF_DOCUMENT_STORE, "readwrite");
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(PDF_DOCUMENT_STORE);
      const existing = await requestResult<unknown>(store.get(validated.jobId));
      if (existing !== undefined) {
        throw revisionConflict(validated.jobId, 0, parseManifest(existing).revision);
      }
      store.add(validated);
      await completed;
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async get(jobId: string): Promise<PdfDocumentManifest | undefined> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(PDF_DOCUMENT_STORE, "readonly");
      const value = await requestResult<unknown>(
        transaction.objectStore(PDF_DOCUMENT_STORE).get(jobId),
      );
      return value === undefined ? undefined : parseManifest(value);
    } catch (error) {
      throw storageError("read", error);
    }
  }

  async save(manifest: PdfDocumentManifest, expectedRevision: number): Promise<void> {
    const validated = PdfDocumentManifestSchema.parse(manifest);
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(PDF_DOCUMENT_STORE, "readwrite");
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(PDF_DOCUMENT_STORE);
      const value = await requestResult<unknown>(store.get(validated.jobId));
      if (value === undefined) {
        throw revisionConflict(validated.jobId, expectedRevision, "missing");
      }
      const existing = parseManifest(value);
      if (existing.revision !== expectedRevision) {
        throw revisionConflict(validated.jobId, expectedRevision, existing.revision);
      }
      if (validated.revision !== expectedRevision + 1) {
        throw revisionConflict(validated.jobId, expectedRevision, "invalid-next-revision");
      }
      store.put(validated);
      await completed;
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async delete(jobId: string): Promise<boolean> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(PDF_DOCUMENT_STORE, "readwrite");
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(PDF_DOCUMENT_STORE);
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

  async listExpired(nowIso: string): Promise<PdfDocumentManifest[]> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(PDF_DOCUMENT_STORE, "readonly");
      const values = await requestResult<unknown[]>(
        transaction.objectStore(PDF_DOCUMENT_STORE).getAll(),
      );
      return values
        .map(parseManifest)
        .filter((manifest) => manifest.expiresAt <= nowIso)
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    } catch (error) {
      throw storageError("read", error);
    }
  }
}
