import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@background": resolve(import.meta.dirname, "src/background"),
      "@capture": resolve(import.meta.dirname, "src/capture"),
      "@content": resolve(import.meta.dirname, "src/content"),
      "@editor": resolve(import.meta.dirname, "src/editor"),
      "@popup": resolve(import.meta.dirname, "src/popup"),
      "@offscreen": resolve(import.meta.dirname, "src/offscreen"),
      "@shared": resolve(import.meta.dirname, "src/shared"),
      "@storage": resolve(import.meta.dirname, "src/storage"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,mjs}"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
