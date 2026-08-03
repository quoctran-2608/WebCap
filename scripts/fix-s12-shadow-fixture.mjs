import { readFile, writeFile } from "node:fs/promises";

const path = "tests/e2e/element-selection.spec.ts";
let content = await readFile(path, "utf8");
const before = `  await targetPage.goto("http://127.0.0.1:4174/element-selection.html");\n  const popup = await openPopup();\n  await startElementSelection(popup);\n  await targetPage.bringToFront();\n\n  const root = targetPage.locator("[data-webcap-element-selector]");\n  const shadowButton = targetPage.locator("open-shadow-card").locator("#shadow-action");\n`;
const after = `  await targetPage.goto("http://127.0.0.1:4174/element-selection.html");\n  const shadowButton = targetPage.locator("open-shadow-card").locator("#shadow-action");\n  await shadowButton.scrollIntoViewIfNeeded();\n  const popup = await openPopup();\n  await startElementSelection(popup);\n  await targetPage.bringToFront();\n\n  const root = targetPage.locator("[data-webcap-element-selector]");\n`;
if (!content.includes(before)) {
  throw new Error("Missing open-shadow fixture pattern.");
}
content = content.replace(before, after);
await writeFile(path, content, "utf8");
