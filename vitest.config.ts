import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const projectRoot = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@background": resolve(projectRoot, "src/background"),
      "@popup": resolve(projectRoot, "src/popup"),
      "@shared": resolve(projectRoot, "src/shared"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
