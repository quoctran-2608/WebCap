import { readFile, writeFile } from "node:fs/promises";

for (const path of [
  "tests/unit/pdf-exporter.test.ts",
  "tests/unit/pdf-export-service.test.ts",
]) {
  let content = await readFile(path, "utf8");
  const withoutTileId = content.replace(/^\s*tileId: tile\.id,\n/m, "");
  if (withoutTileId === content) {
    throw new Error(`Missing tileId fixture field in ${path}`);
  }
  content = withoutTileId;

  const createdAtPattern = /(\n\s*createdAt: (?:NOW\.toISOString\(\)|"2026-08-03T11:00:00\.000Z"),)\n(\s*)expiresAt: "2026-08-03T11:30:00\.000Z",/m;
  if (!createdAtPattern.test(content)) {
    throw new Error(`Missing stored tile timestamp fields in ${path}`);
  }
  content = content.replace(createdAtPattern, "$1\n$2updatedAt: \"2026-08-03T11:00:00.000Z\",");
  await writeFile(path, content, "utf8");
}
