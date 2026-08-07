export const WEBCAP_DATABASE_NAME = "webcap-db";
export const WEBCAP_DATABASE_VERSION = 1;

export const WEBCAP_STORES = Object.freeze({
  jobs: "jobs",
  tiles: "tiles",
  artifacts: "artifacts",
  dedupe: "dedupe",
});

export interface OpenDatabaseOptions {
  factory?: IDBFactory;
}

function createSchema(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(WEBCAP_STORES.jobs)) {
    const jobs = database.createObjectStore(WEBCAP_STORES.jobs, { keyPath: "id" });
    jobs.createIndex("byState", "state", { unique: false });
    jobs.createIndex("byExpiresAt", "expiresAt", { unique: false });
  }

  if (!database.objectStoreNames.contains(WEBCAP_STORES.tiles)) {
    const tiles = database.createObjectStore(WEBCAP_STORES.tiles, {
      keyPath: ["jobId", "index"],
    });
    tiles.createIndex("byJobId", "jobId", { unique: false });
  }

  if (!database.objectStoreNames.contains(WEBCAP_STORES.artifacts)) {
    const artifacts = database.createObjectStore(WEBCAP_STORES.artifacts, {
      keyPath: "artifactId",
    });
    artifacts.createIndex("byJobId", "jobId", { unique: false });
  }

  if (!database.objectStoreNames.contains(WEBCAP_STORES.dedupe)) {
    database.createObjectStore(WEBCAP_STORES.dedupe, { keyPath: "requestId" });
  }
}

export function openWebCapDatabase(options: OpenDatabaseOptions = {}): Promise<IDBDatabase> {
  const factory = options.factory ?? indexedDB;

  return new Promise((resolve, reject) => {
    const request = factory.open(WEBCAP_DATABASE_NAME, WEBCAP_DATABASE_VERSION);
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
      reject(request.error ?? new Error("Unable to open WebCap IndexedDB."));
    };
    request.onblocked = () => {
      reject(new Error("WebCap IndexedDB upgrade is blocked."));
    };
  });
}
