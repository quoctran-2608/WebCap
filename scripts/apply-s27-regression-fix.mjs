import { readFile, writeFile } from "node:fs/promises";

async function replace(path, before, after) {
  let text = await readFile(path, "utf8");
  if (!text.includes(before)) throw new Error(`S27 regression anchor missing in ${path}`);
  text = text.replace(before, after);
  await writeFile(path, text);
}

await replace(
  "src/capture/scroll-area-capture-engine.ts",
  `        page.layoutChanged &&
        documentPageMap !== undefined &&`,
  `        page.layoutChanged &&
        (documentPageMap !== undefined || plan.limitedByMaxTiles) &&`,
);

await replace(
  "tests/unit/scroll-area-capture-engine.test.ts",
  `      result.partialCapture,
    );`,
  `      result.partialCapture,
      undefined,
    );`,
);
