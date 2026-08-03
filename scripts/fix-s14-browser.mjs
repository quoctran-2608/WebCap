import { readFile, writeFile } from "node:fs/promises";

async function replaceExact(path, before, after) {
  const content = await readFile(path, "utf8");
  if (!content.includes(before)) {
    throw new Error(`Expected S14 browser text was not found in ${path}.`);
  }
  await writeFile(path, content.replace(before, after));
}

await replaceExact(
  "src/popup/App.tsx",
  '  ready: "Tile set đã sẵn sàng để biên tập PDF.",',
  '  ready: "Tile set toàn trang đã sẵn sàng.",',
);
await replaceExact(
  "tests/e2e/pdf-editor.spec.ts",
  '  await expect(popup.getByText("Tile set đã sẵn sàng để biên tập PDF.")).toBeVisible({',
  '  await expect(popup.getByText("Tile set toàn trang đã sẵn sàng.")).toBeVisible({',
);
