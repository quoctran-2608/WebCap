import { VISIBLE_SESSION_STORAGE_KEY } from "@shared/constants";
import {
  VisibleSessionSnapshotSchema,
  type VisibleSessionSnapshot,
} from "@shared/contracts/visible-session";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

export interface SessionStorageAreaAdapter {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface VisibleSessionRepositoryPort {
  load(): Promise<VisibleSessionSnapshot | undefined>;
  save(snapshot: VisibleSessionSnapshot): Promise<void>;
  clear(): Promise<void>;
}

export const chromeSessionStorageAdapter: SessionStorageAreaAdapter = {
  get: (key) => chrome.storage.session.get(key),
  set: (items) => chrome.storage.session.set(items),
  remove: (key) => chrome.storage.session.remove(key),
};

function storageError(operation: "read" | "write", error: unknown): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: operation === "read" ? "E_STORAGE_READ" : "E_STORAGE_WRITE",
      stage: "storage",
      message:
        error instanceof Error && error.message.length > 0
          ? error.message
          : `WebCap could not ${operation} the visible capture session.`,
      userMessageKey: operation === "read" ? "errors.sessionRead" : "errors.sessionWrite",
      retryable: true,
      fallbackAllowed: false,
      causeCode: error instanceof Error ? error.name : "SessionStorageFailure",
    }),
  );
}

export class VisibleSessionRepository implements VisibleSessionRepositoryPort {
  constructor(private readonly storage: SessionStorageAreaAdapter = chromeSessionStorageAdapter) {}

  async load(): Promise<VisibleSessionSnapshot | undefined> {
    try {
      const stored = await this.storage.get(VISIBLE_SESSION_STORAGE_KEY);
      const value = stored[VISIBLE_SESSION_STORAGE_KEY];
      if (value === undefined) {
        return undefined;
      }

      const parsed = VisibleSessionSnapshotSchema.safeParse(value);
      if (!parsed.success) {
        await this.storage.remove(VISIBLE_SESSION_STORAGE_KEY);
        return undefined;
      }
      return parsed.data;
    } catch (error) {
      throw storageError("read", error);
    }
  }

  async save(snapshot: VisibleSessionSnapshot): Promise<void> {
    const validated = VisibleSessionSnapshotSchema.parse(snapshot);
    try {
      await this.storage.set({ [VISIBLE_SESSION_STORAGE_KEY]: validated });
    } catch (error) {
      throw storageError("write", error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.storage.remove(VISIBLE_SESSION_STORAGE_KEY);
    } catch (error) {
      throw storageError("write", error);
    }
  }
}
