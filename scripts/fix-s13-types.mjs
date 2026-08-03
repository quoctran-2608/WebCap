import { readFile, writeFile } from "node:fs/promises";

const path = "src/offscreen/pdf-exporter.ts";
let content = await readFile(path, "utf8");
const before = `      const blob = new Blob([bytes], { type: "application/pdf" });`;
const after = `      const ownedBytes = Uint8Array.from(bytes);\n      const blob = new Blob([ownedBytes.buffer], { type: "application/pdf" });`;
if (!content.includes(before)) {
  throw new Error("Missing PDF Blob boundary pattern.");
}
content = content.replace(before, after);
await writeFile(path, content, "utf8");
