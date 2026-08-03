import { readFile, writeFile } from "node:fs/promises";

async function replace(path, before, after, expectedCount = 1) {
  const source = await readFile(path, "utf8");
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} matches in ${path}, found ${count}: ${before}`);
  }
  await writeFile(path, source.split(before).join(after), "utf8");
}

await replace("src/content/entry.ts", "state.region = undefined;", "delete state.region;", 3);
await replace(
  "src/background/job-coordinator.ts",
  "  getActiveForTab(tabId: number): Promise<CaptureJob | undefined>;",
  "  getActiveForTab?(tabId: number): Promise<CaptureJob | undefined>;",
);
await replace(
  "src/background/persistent-job-router.ts",
  "job: (await dependencies.jobs.getActiveForTab(request.payload.tabId)) ?? null,",
  "job: (await dependencies.jobs.getActiveForTab?.(request.payload.tabId)) ?? null,",
);
