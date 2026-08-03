import { readFile, writeFile } from "node:fs/promises";

async function replace(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) throw new Error(`Expected block was not found in ${path}`);
  await writeFile(path, source.replace(before, after));
}

await replace(
  "src/background/message-router.ts",
  `import type {
  VisibleSessionSnapshot,`,
  `import { isOffscreenPdfExportProgressMessage } from "@shared/contracts/offscreen";
import type {
  VisibleSessionSnapshot,`,
);

await replace(
  "src/background/message-router.ts",
  `    !isPersistentJobMessageType(value) &&
    !isRegionSelectionEventType(value)`,
  `    !isPersistentJobMessageType(value) &&
    !isOffscreenPdfExportProgressMessage(value) &&
    !isRegionSelectionEventType(value)`,
);

await replace(
  "tests/unit/artifact-repository.test.ts",
  `          request.onsuccess?.call(request, new Event("success"));
          transaction.oncomplete?.call(transaction, new Event("complete"));`,
  `          request.onsuccess?.call(request, new Event("success"));`,
);

await replace(
  "tests/unit/artifact-repository.test.ts",
  `  it("subscribes to transaction completion before a fast read request can finish", async () => {`,
  `  it("resolves a readonly request without waiting for transaction completion", async () => {`,
);

await replace(
  "tests/unit/job-repository.test.ts",
  `describe("IndexedDbJobRepository", () => {
  it("rejects stale compare-and-set writes", async () => {`,
  `describe("IndexedDbJobRepository", () => {
  it("resolves readonly job requests without waiting for transaction completion", async () => {
    const stored = job(1);
    const repository = new IndexedDbJobRepository({
      openDatabase: () => Promise.resolve(databaseWithStoredJob(stored)),
    });

    await expect(repository.get(stored.id)).resolves.toEqual(stored);
  });

  it("rejects stale compare-and-set writes", async () => {`,
);
