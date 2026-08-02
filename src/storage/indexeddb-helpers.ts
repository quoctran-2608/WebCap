import {
  WebCapRuntimeError,
  createWebCapError,
  createWebCapRuntimeError,
} from "@shared/errors/error";

export function storageError(operation: "read" | "write", error: unknown): Error {
  if (error instanceof WebCapRuntimeError) {
    return error;
  }

  const causeCode = error instanceof DOMException ? error.name : undefined;
  const quota = causeCode === "QuotaExceededError";
  return createWebCapRuntimeError(
    createWebCapError({
      code: quota ? "E_STORAGE_QUOTA" : operation === "read" ? "E_STORAGE_READ" : "E_STORAGE_WRITE",
      stage: "storage",
      message: quota
        ? "WebCap local storage quota was exceeded."
        : `WebCap could not ${operation} persistent job storage.`,
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

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}
