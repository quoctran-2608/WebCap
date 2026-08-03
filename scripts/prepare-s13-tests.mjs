import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let content = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (!content.includes(before)) {
      throw new Error(`Missing test patch in ${path}: ${before.slice(0, 120)}`);
    }
    content = content.replace(before, after);
  }
  await writeFile(path, content, "utf8");
}

await patch("tests/unit/pdf-layout.test.ts", [
  [`      expect(current?.sourceRectCss).toBeUndefined();\n`, ``],
]);

await patch("tests/unit/pdf-exporter.test.ts", [
  [
    `            Promise.resolve(new Blob([ONE_PIXEL_JPEG], { type: "image/jpeg" })),`,
    `            Promise.resolve(\n              new Blob([Uint8Array.from(ONE_PIXEL_JPEG).buffer], { type: "image/jpeg" }),\n            ),`,
  ],
]);
