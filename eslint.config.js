import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const typescriptFiles = ["**/*.{ts,tsx}"];

export default tseslint.config(
  {
    ignores: [
      "artifacts/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "pnpm-lock.yaml",
    ],
  },
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"],
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  eslintConfigPrettier,
);
