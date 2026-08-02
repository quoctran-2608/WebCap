import { describe, expect, it } from "vitest";

import { VISIBLE_SESSION_STORAGE_KEY } from "@shared/constants";
import type { VisibleSessionSnapshot } from "@shared/contracts/visible-session";
import {
  VisibleSessionRepository,
  type SessionStorageAreaAdapter,
} from "@storage/visible-session-repository";

const snapshot: VisibleSessionSnapshot = {
  schemaVersion: 1,
  sessionId: "session-1",
  captureRequestId: "capture-1",
  status: "ready",
  format: "png",
  quality: 0.92,
  createdAt: "2026-08-02T09:00:00.000Z",
  updatedAt: "2026-08-02T09:00:01.000Z",
  source: {
    captureId: "source-1",
    tabId: 1,
    windowId: 2,
    mimeType: "image/png",
    byteLength: 128,
    width: 10,
    height: 20,
  },
  artifact: {
    artifactId: "artifact-1",
    sourceArtifactId: "source-1",
    format: "png",
    mimeType: "image/png",
    filename: "capture.png",
    byteLength: 100,
    width: 10,
    height: 20,
    createdAt: "2026-08-02T09:00:01.000Z",
    expiresAt: "2026-08-02T09:30:01.000Z",
  },
};

function memoryStorage(initial?: unknown): {
  storage: SessionStorageAreaAdapter;
  values: Map<string, unknown>;
  removed: string[];
} {
  const values = new Map<string, unknown>();
  if (initial !== undefined) {
    values.set(VISIBLE_SESSION_STORAGE_KEY, initial);
  }
  const removed: string[] = [];

  return {
    values,
    removed,
    storage: {
      get: (key) => Promise.resolve(values.has(key) ? { [key]: values.get(key) } : {}),
      set: (items) => {
        for (const [key, value] of Object.entries(items)) {
          values.set(key, value);
        }
        return Promise.resolve();
      },
      remove: (key) => {
        removed.push(key);
        values.delete(key);
        return Promise.resolve();
      },
    },
  };
}

describe("VisibleSessionRepository", () => {
  it("persists and restores a validated session snapshot", async () => {
    const memory = memoryStorage();
    const repository = new VisibleSessionRepository(memory.storage);

    await repository.save(snapshot);

    await expect(repository.load()).resolves.toEqual(snapshot);
    expect(memory.values.get(VISIBLE_SESSION_STORAGE_KEY)).toEqual(snapshot);
  });

  it("removes malformed stored session data", async () => {
    const memory = memoryStorage({ status: "ready", artifact: { blob: "binary" } });
    const repository = new VisibleSessionRepository(memory.storage);

    await expect(repository.load()).resolves.toBeUndefined();
    expect(memory.removed).toEqual([VISIBLE_SESSION_STORAGE_KEY]);
  });

  it("clears the current session", async () => {
    const memory = memoryStorage(snapshot);
    const repository = new VisibleSessionRepository(memory.storage);

    await repository.clear();

    await expect(repository.load()).resolves.toBeUndefined();
  });
});
