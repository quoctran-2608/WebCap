export const PDF_DOCUMENT_DATABASE_NAME = "webcap-pdf-db";
export const PDF_DOCUMENT_DATABASE_VERSION = 1;
export const PDF_DOCUMENT_STORE = "pdfDocuments";

export interface OpenPdfDocumentDatabaseOptions {
  factory?: IDBFactory;
}

function createSchema(database: IDBDatabase): void {
  if (database.objectStoreNames.contains(PDF_DOCUMENT_STORE)) return;
  const documents = database.createObjectStore(PDF_DOCUMENT_STORE, { keyPath: "jobId" });
  documents.createIndex("byExpiresAt", "expiresAt", { unique: false });
}

export function openPdfDocumentDatabase(
  options: OpenPdfDocumentDatabaseOptions = {},
): Promise<IDBDatabase> {
  const factory = options.factory ?? indexedDB;
  return new Promise((resolve, reject) => {
    const request = factory.open(PDF_DOCUMENT_DATABASE_NAME, PDF_DOCUMENT_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      createSchema(request.result);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
      };
      resolve(database);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Unable to open WebCap PDF document IndexedDB."));
    };
    request.onblocked = () => {
      reject(new Error("WebCap PDF document IndexedDB upgrade is blocked."));
    };
  });
}
