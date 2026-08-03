import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let content = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (!content.includes(before)) {
      throw new Error(`Missing patch pattern in ${path}: ${before.slice(0, 140)}`);
    }
    content = content.replace(before, after);
  }
  await writeFile(path, content, "utf8");
}

await patch("src/content/element-selector.ts", [
  [
    `function candidateFromPoint(clientX: number, clientY: number): Element | undefined {\n  return document\n    .elementsFromPoint(clientX, clientY)\n    .find((candidate) => isSelectableElement(candidate));\n}\n`,
    `function candidatesAtPoint(root: Document | ShadowRoot, clientX: number, clientY: number): Element[] {\n  return typeof root.elementsFromPoint === "function"\n    ? root.elementsFromPoint(clientX, clientY)\n    : [];\n}\n\nfunction deepestOpenShadowCandidate(\n  root: Document | ShadowRoot,\n  clientX: number,\n  clientY: number,\n): Element | undefined {\n  for (const candidate of candidatesAtPoint(root, clientX, clientY)) {\n    if (isSelectorNode(candidate)) {\n      continue;\n    }\n    const shadowRoot = candidate.shadowRoot;\n    if (shadowRoot?.mode === "open") {\n      const nested = deepestOpenShadowCandidate(shadowRoot, clientX, clientY);\n      if (nested !== undefined) {\n        return nested;\n      }\n    }\n    if (isSelectableElement(candidate)) {\n      return candidate;\n    }\n  }\n  return undefined;\n}\n\nfunction candidateFromPoint(clientX: number, clientY: number): Element | undefined {\n  return deepestOpenShadowCandidate(document, clientX, clientY);\n}\n`,
  ],
  [
    `    const candidate =\n      candidateFromComposedPath(event.composedPath()) ??\n      candidateFromPoint(event.clientX, event.clientY);\n`,
    `    const candidate =\n      candidateFromPoint(event.clientX, event.clientY) ??\n      candidateFromComposedPath(event.composedPath());\n`,
  ],
  [
    `    const candidate =\n      candidateFromComposedPath(event.composedPath()) ??\n      candidateFromPoint(event.clientX, event.clientY);\n`,
    `    const candidate =\n      candidateFromPoint(event.clientX, event.clientY) ??\n      candidateFromComposedPath(event.composedPath());\n`,
  ],
]);

await patch("tests/e2e/element-selection.spec.ts", [
  [
    `  await expect(root.getByText(/span#target-child\\.capture-child\\.violet-panel/u)).toBeVisible();\n`,
    `  await expect(root.locator("[data-label]")).toContainText(\n    "span#target-child.capture-child.violet-panel",\n  );\n`,
  ],
  [
    `  await expect(root.getByText(/article#target-card\\.capture-card\\.outer-card/u)).toBeVisible();\n`,
    `  await expect(root.locator("[data-label]")).toContainText(\n    "article#target-card.capture-card.outer-card",\n  );\n`,
  ],
  [
    `  await expect(root.getByText(/span#target-child\\.capture-child\\.violet-panel/u)).toBeVisible();\n`,
    `  await expect(root.locator("[data-label]")).toContainText(\n    "span#target-child.capture-child.violet-panel",\n  );\n`,
  ],
  [
    `  await expect(root.getByText(/button#shadow-action\\.shadow-button/u)).toBeVisible();\n`,
    `  await expect(root.locator("[data-label]")).toContainText(\n    "button#shadow-action.shadow-button",\n  );\n`,
  ],
]);
