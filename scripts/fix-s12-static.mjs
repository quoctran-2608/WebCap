import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let content = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (!content.includes(before)) {
      throw new Error(`Missing patch pattern in ${path}: ${before.slice(0, 120)}`);
    }
    content = content.replace(before, after);
  }
  await writeFile(path, content, "utf8");
}

await patch("src/shared/contracts/element-selection.ts", [
  [
    `  type ElementTargetDescriptor,\n  type Rect,\n`,
    `  type ElementTargetDescriptor,\n`,
  ],
]);

await patch("src/content/element-selector.ts", [
  [
    `import { CoordinateSpace } from "./coordinate-space";\n`,
    `import { CoordinateSpace, clampRectToBounds } from "./coordinate-space";\n`,
  ],
  [
    `export function readElementDocumentRect(element: Element): Rect {\n  const clientRect = element.getBoundingClientRect();\n  return CoordinateSpace.fromWindow().clampRect({\n    x: clientRect.left + window.scrollX,\n    y: clientRect.top + window.scrollY,\n    width: clientRect.width,\n    height: clientRect.height,\n  });\n}\n`,
    `export function readElementDocumentRect(element: Element): Rect {\n  const clientRect = element.getBoundingClientRect();\n  const space = CoordinateSpace.fromWindow();\n  return clampRectToBounds(\n    space.clientRectToDocument({\n      x: clientRect.left,\n      y: clientRect.top,\n      width: clientRect.width,\n      height: clientRect.height,\n    }),\n    space.documentBounds,\n  );\n}\n`,
  ],
  [
    `  let selected: Element | undefined;\n  let disposed = false;\n`,
    `  let selected: Element | undefined;\n  let selectedRect: Rect | undefined;\n  let disposed = false;\n`,
  ],
  [
    `            rect: readElementDocumentRect(target),\n`,
    `            rect: selectedRect ?? readElementDocumentRect(target),\n`,
  ],
  [
    `    selected = candidate;\n    hovered = candidate;\n`,
    `    selected = candidate;\n    selectedRect = readElementDocumentRect(candidate);\n    hovered = candidate;\n`,
  ],
  [
    `        selected = parent;\n        hovered = parent;\n`,
    `        selected = parent;\n        selectedRect = readElementDocumentRect(parent);\n        hovered = parent;\n`,
  ],
  [
    `        selected = child;\n        hovered = child;\n`,
    `        selected = child;\n        selectedRect = readElementDocumentRect(child);\n        hovered = child;\n`,
  ],
]);
