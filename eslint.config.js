// ESLint flat config: type-aware typescript-eslint rules, with formatting left to Prettier.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "scan/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: { allowDefaultProject: ["*.js", "*.ts"] }, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-console": ["error", { allow: ["error", "warn"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Tests read loosely-typed JSON reports and mock RPC payloads.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Examples are plain dependency-free JS for users to copy; lint them without type information.
    files: ["examples/**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { "no-console": "off" },
  },
  prettier,
);
