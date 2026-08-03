import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import ts from "typescript";

const projectRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(projectRoot, "src/content/entry.ts");
const outputDirectory = resolve(projectRoot, "dist");
const outputPath = resolve(outputDirectory, "content-script.js");
const source = await readFile(sourcePath, "utf8");
const result = ts.transpileModule(source, {
  fileName: sourcePath,
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: true,
    removeComments: false,
    newLine: ts.NewLineKind.LineFeed,
  },
});

const errors = (result.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);
if (errors.length > 0) {
  const host = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => projectRoot,
    getNewLine: () => "\n",
  };
  throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, host));
}

const commonJsOutput = result.outputText.replace(/^"use strict";\s*/u, "");
const wrapped = [
  "(() => {",
  '  "use strict";',
  "  const exports = {};",
  commonJsOutput
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n"),
  "})();",
  "",
].join("\n");

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, wrapped, "utf8");
