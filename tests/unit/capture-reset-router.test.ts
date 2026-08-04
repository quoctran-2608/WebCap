import { describe, expect, it, vi } from "vitest";

import {
  routePersistentJobMessage,
  type PersistentJobRouterDependencies,
} from "@background/persistent-job-router";
import type { PersistentJobCoordinatorPort } from "@background/job-coordinator";
import { createCaptureResetRequest } from "@shared/contracts/capture-reset";
import type { StoredDedupeRecord } from "@shared/contracts/job";
import type { DedupeRepositoryPort } from "@storage/dedupe-repository";

const now = new Date("2026-08-04T15:00:00.000Z");

class MemoryDedupe implements DedupeRepositoryPort {
  readonly values = new Map<string, StoredDedupeRecord>();
  get(requestId: string): Promise<StoredDedupeRecord | undefined> {
    return Promise.resolve(this.values.get(requestId));
  }
  put(record: StoredDedupeRecord): Promise<void> {
    this.values.set(record.requestId, record);
    return Promise.resolve();
  }
  deleteExpired(): Promise<number> {
    return Promise.resolve(0);
  }
}

describe("capture reset routing", () => {
  it("returns a versioned reset report and deduplicates repeated requests", async () => {
    const reset = vi.fn(() =>
      Promise.resolve({
        schemaVersion: 1 as const,
        scope: "job" as const,
        jobId: "job-1",
        tabId: 7,
        cancellationAttempted: false,
        cancellationCompleted: true,
        deletedJobs: 1,
        deletedTiles: 2,
        deletedArtifacts: 3,
        deletedManifests: 1,
        clearedSessions: 1,
      }),
    );
    const dependencies: PersistentJobRouterDependencies = {
      jobs: {} as PersistentJobCoordinatorPort,
      dedupe: new MemoryDedupe(),
      reset: { reset },
      now: () => now,
    };
    const request = createCaptureResetRequest({
      requestId: "reset-request-1",
      sentAt: now.toISOString(),
      scope: "job",
      jobId: "job-1",
    });

    const first = await routePersistentJobMessage(request, dependencies);
    const second = await routePersistentJobMessage(request, dependencies);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      type: "CAPTURE_RESET_RESPONSE",
      requestId: "reset-request-1",
      payload: { deletedJobs: 1, deletedTiles: 2, deletedArtifacts: 3 },
    });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
