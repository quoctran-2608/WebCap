import { readFile, writeFile } from "node:fs/promises";

for (const path of [
  "tests/unit/pdf-exporter.test.ts",
  "tests/unit/pdf-export-service.test.ts",
]) {
  let content = await readFile(path, "utf8");
  if (!content.includes(`      tileId: tile.id,\n`)) {
    throw new Error(`Missing tileId fixture field in ${path}`);
  }
  content = content.replace(`      tileId: tile.id,\n`, ``);
  if (!content.includes(`      expiresAt: "2026-08-03T11:30:00.000Z",\n`)) {
    throw new Error(`Missing fixture expiry field in ${path}`);
  }
  content = content.replace(
    `      expiresAt: "2026-08-03T11:30:00.000Z",\n`,
    `      updatedAt: "2026-08-03T11:00:00.000Z",\n`,
  );
  await writeFile(path, content, "utf8");
}
