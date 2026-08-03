import { readFile, writeFile } from "node:fs/promises";

const path = "tests/e2e/element-selection.spec.ts";
let content = await readFile(path, "utf8");
const boxPattern = `  const box = await shadowButton.boundingBox();\n  if (box === null) throw new Error("Open shadow target is not visible.");\n`;
const boxReplacement = `  const box = await shadowButton.boundingBox();\n  if (box === null) throw new Error("Open shadow target is not visible.");\n  const documentOffset = await targetPage.evaluate(() => ({\n    x: window.scrollX,\n    y: window.scrollY,\n  }));\n`;
if (!content.includes(boxPattern)) {
  throw new Error("Missing shadow bounding-box pattern.");
}
content = content.replace(boxPattern, boxReplacement);
const assertionPattern = `  expect(state.job?.targetRect).toMatchObject({\n    x: box.x,\n    y: box.y,\n    width: box.width,\n    height: box.height,\n  });\n`;
const assertionReplacement = `  expect(state.job?.targetRect).toMatchObject({\n    x: box.x + documentOffset.x,\n    y: box.y + documentOffset.y,\n    width: box.width,\n    height: box.height,\n  });\n`;
if (!content.includes(assertionPattern)) {
  throw new Error("Missing shadow coordinate assertion pattern.");
}
content = content.replace(assertionPattern, assertionReplacement);
await writeFile(path, content, "utf8");
