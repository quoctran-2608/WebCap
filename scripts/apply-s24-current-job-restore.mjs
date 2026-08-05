import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const coordinatorPath = "src/background/job-coordinator.ts";
let coordinator = readFileSync(coordinatorPath, "utf8");
coordinator = replaceOnce(
  coordinator,
  `  async getActiveForTab(tabId: number): Promise<CaptureJob | undefined> {\n    await this.initialize();\n    const active = await this.jobs.listActive();\n    return active\n      .filter((job) => job.tabId === tabId)\n      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];\n  }`,
  `  async getActiveForTab(tabId: number): Promise<CaptureJob | undefined> {\n    await this.initialize();\n    const active = (await this.jobs.listActive())\n      .filter((job) => job.tabId === tabId)\n      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];\n    if (active !== undefined) {\n      return active;\n    }\n\n    // The popup uses this lookup to restore its current capture surface. Once output reaches\n    // completed, it is no longer active, but the durable result must remain discoverable across\n    // popup close/reopen cycles until reset or expiry removes the job and its summary.\n    const summaries = (await this.sessions.listSummaries())\n      .filter((summary) => summary.tabId === tabId)\n      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));\n    for (const summary of summaries) {\n      const job = await this.jobs.get(summary.jobId);\n      if (job !== undefined) {\n        return job;\n      }\n    }\n    return undefined;\n  }`,
  "current job restore policy",
);
writeFileSync(coordinatorPath, coordinator);

const testPath = "tests/unit/job-coordinator.test.ts";
let test = readFileSync(testPath, "utf8");
test = replaceOnce(
  test,
  `  it("cancels a created job through legal transitions and releases the lock", async () => {`,
  `  it("prefers an active job and restores the latest durable terminal job for a tab", async () => {\n    const { coordinator, jobs, sessions } = setup();\n    const older = storedJob("completed", {\n      id: "job-completed-older",\n      updatedAt: "2026-08-02T16:00:30.000Z",\n    });\n    const latest = storedJob("completed", {\n      id: "job-completed-latest",\n      updatedAt: "2026-08-02T16:01:30.000Z",\n    });\n    const active = storedJob("created", {\n      id: "job-active",\n      updatedAt: "2026-08-02T16:01:00.000Z",\n      cleanup: { attempted: false, completed: false },\n    });\n    jobs.records.set(older.id, older);\n    jobs.records.set(latest.id, latest);\n    jobs.records.set(active.id, active);\n    sessions.summaries.set(older.id, summarizeJob(older));\n    sessions.summaries.set(latest.id, summarizeJob(latest));\n\n    await expect(coordinator.getActiveForTab(7)).resolves.toMatchObject({ id: active.id });\n\n    jobs.records.delete(active.id);\n    await expect(coordinator.getActiveForTab(7)).resolves.toMatchObject({ id: latest.id });\n  });\n\n  it("cancels a created job through legal transitions and releases the lock", async () => {`,
  "coordinator current job unit test",
);
writeFileSync(testPath, test);
