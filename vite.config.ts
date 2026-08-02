import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": resolve(import.meta.dirname, "src/shared"),
    },
  },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/shared/index.ts"),
      formats: ["es"],
      fileName: "webcap-foundation",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
