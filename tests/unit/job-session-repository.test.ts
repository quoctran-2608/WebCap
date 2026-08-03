import { describe, expect, it } from "vitest";

import { JOB_SESSION_STORAGE_KEY } from "@shared/constants";
import type { JobSummary, TabJobLock } from "@shared/contracts/job";
import {
  JobSessionRepository,
  type JobSessionStorageAdapter,
} from "@storage/job-session-repository";

class MemorySessionStorage implements JobSessionStorageAdapter {
  readonly values: Record<string, unknown> = {};
  failRead = false;
  failWrite = false;

  get(): Promise<Record<string, unknown>> {
    if (this.failRead) {
      return Promise.reject(new Error("read failed"));
    }
    return Promise.resolve({ ...this.values });
  }

  set(items: Record<string, unknown>): Promise<void> {
    if (this.failWrite) {
      return Promise.reject(new Error("write failed"));
    }
    Object.assign(this.values, items);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    delete this.values[key];
    return Promise.resolve();
  }
}

const summary: JobSummary = {
  schemaVersion: 1,
  jobId: "job-1",
  tabId: 7,
  mode: "full-page",
  state: "created",
  stateRevision: 0,
  completedTiles: 0,
  totalTiles: 0,
  updatedAt: "2026-08-02T16:00:00.000Z",
  expiresAt: "2026-08-02T16:30:00.000Z",
};

function lock(jobId: string, leaseExpiresAt: string): TabJobLock {
  return {
    schemaVersion: 1,
    tabId: 7,
    jobId,
    acquiredAt: "2026-08-02T16:00:00.000Z",
    leaseExpiresAt,
  };
}

describe("JobSessionRepository", () => {
  it("stores metadata-only summaries", async () => {
    const storage = new MemorySessionStorage();
    const repository = new JobSessionRepository(storage);
    await repository.saveSummary(summary);
    expect(await repository.getSummary("job-1")).toEqual(summary);
    expect(JSON.stringify(storage.values)).not.toContain("blob");
  });

  it("prevents a second job from acquiring an active tab lease", async () => {
    const repository = new JobSessionRepository(new MemorySessionStorage());
    const first = await repository.acquireTabLock(
      lock("job-1", "2026-08-02T16:05:00.000Z"),
      "2026-08-02T16:01:00.000Z",
    );
    const second = await repository.acquireTabLock(
      lock("job-2", "2026-08-02T16:06:00.000Z"),
      "2026-08-02T16:01:00.000Z",
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("replaces an expired tab lease", async () => {
    const repository = new JobSessionRepository(new MemorySessionStorage());
    await repository.acquireTabLock(
      lock("job-1", "2026-08-02T16:01:00.000Z"),
      "2026-08-02T16:00:00.000Z",
    );
    const acquired = await repository.acquireTabLock(
      lock("job-2", "2026-08-02T16:10:00.000Z"),
      "2026-08-02T16:02:00.000Z",
    );
    expect(acquired).toBe(true);
    expect(await repository.getTabLock(7)).toMatchObject({ jobId: "job-2" });
  });

  it("clears invalid session payloads instead of restoring them", async () => {
    const storage = new MemorySessionStorage();
    storage.values[JOB_SESSION_STORAGE_KEY] = { schemaVersion: 999, summaries: "bad" };
    const repository = new JobSessionRepository(storage);
    expect(await repository.listSummaries()).toEqual([]);
    expect(storage.values[JOB_SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("normalizes storage failures", async () => {
    const storage = new MemorySessionStorage();
    storage.failRead = true;
    const repository = new JobSessionRepository(storage);
    await expect(repository.listSummaries()).rejects.toMatchObject({
      code: "E_STORAGE_READ",
      stage: "storage",
    });
  });
});
