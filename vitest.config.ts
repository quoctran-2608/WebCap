import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@background": resolve(import.meta.dirname, "src/background"),
      "@popup": resolve(import.meta.dirname, "src/popup"),
      "@offscreen": resolve(import.meta.dirname, "src/offscreen"),
      "@shared": resolve(import.meta.dirname, "src/shared"),
      "@storage": resolve(import.meta.dirname, "src/storage"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
