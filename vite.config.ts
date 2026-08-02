import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const projectRoot = import.meta.dirname;
const popupRoot = resolve(projectRoot, "src/popup");
const offscreenRoot = resolve(projectRoot, "src/offscreen");
const iconData = JSON.parse(
  readFileSync(resolve(projectRoot, "assets/icons.json"), "utf8"),
) as Record<string, string>;

function offscreenHtmlPlugin(): Plugin {
  return {
    name: "webcap-offscreen-html",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "offscreen.html",
        source:
          '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>WebCap Offscreen Processor</title></head><body><script type="module" src="./offscreen.js"></script></body></html>',
      });
    },
  };
}

function extensionIconPlugin(): Plugin {
  return {
    name: "webcap-extension-icons",
    apply: "build",
    generateBundle() {
      for (const size of ["16", "32", "48", "128"] as const) {
        const encodedIcon = iconData[size];
        if (encodedIcon === undefined) {
          throw new Error(`Missing base64 icon source for ${size}x${size}.`);
        }

        this.emitFile({
          type: "asset",
          fileName: `icons/icon-${size}.png`,
          source: Buffer.from(encodedIcon, "base64"),
        });
      }
    },
  };
}

export default defineConfig({
  root: popupRoot,
  base: "./",
  publicDir: resolve(projectRoot, "public"),
  plugins: [react(), extensionIconPlugin(), offscreenHtmlPlugin()],
  resolve: {
    alias: {
      "@background": resolve(projectRoot, "src/background"),
      "@popup": resolve(projectRoot, "src/popup"),
      "@offscreen": resolve(projectRoot, "src/offscreen"),
      "@shared": resolve(projectRoot, "src/shared"),
      "@storage": resolve(projectRoot, "src/storage"),
    },
  },
  build: {
    target: "chrome116",
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
      input: {
        popup: resolve(popupRoot, "popup.html"),
        offscreen: resolve(offscreenRoot, "entry.ts"),
        "service-worker": resolve(projectRoot, "src/background/service-worker.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "service-worker"
            ? "service-worker.js"
            : chunkInfo.name === "offscreen"
              ? "offscreen.js"
              : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
