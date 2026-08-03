import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "vite";

const projectRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(projectRoot, "src/content/entry.ts");
const outputDirectory = resolve(projectRoot, "dist");

await mkdir(outputDirectory, { recursive: true });
await build({
  configFile: false,
  logLevel: "error",
  build: {
    outDir: outputDirectory,
    emptyOutDir: false,
    target: "es2022",
    minify: false,
    sourcemap: false,
    lib: {
      entry: sourcePath,
      name: "WebCapContentRuntime",
      formats: ["iife"],
      fileName: () => "content-script.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
