const { defineConfig, globalIgnores } = require("eslint/config");

const tsParser = require("@typescript-eslint/parser");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const noOnlyTests = require("eslint-plugin-no-only-tests");
const globals = require("globals");
const js = require("@eslint/js");

const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = defineConfig([
  globalIgnores(["**/node_modules/", "**/build/", "**/dist/"]),
  {
    // Only lint TypeScript sources. This restores the behavior of the old
    // `eslint . --ext .ts` invocation; flat config no longer honors `--ext`
    // and would otherwise lint generated/vendored .js files.
    files: ["**/*.ts"],

    languageOptions: {
      parser: tsParser,

      globals: {
        ...globals.node,
      },
    },

    plugins: {
      "@typescript-eslint": typescriptEslint,
      "no-only-tests": noOnlyTests,
    },

    extends: compat.extends(
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended",
      "prettier",
    ),

    rules: {
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn"],
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-only-tests/no-only-tests": "error",
      // chai assertions (e.g. `expect(x).to.be.true`) read as unused
      // expressions; this rule is new in @typescript-eslint's recommended set.
      "@typescript-eslint/no-unused-expressions": "off",
      // New in eslint:recommended (ESLint 10); not enforced under the previous
      // ESLint 8 config. Kept off to preserve prior behavior.
      "preserve-caught-error": "off",
    },
  },
]);
