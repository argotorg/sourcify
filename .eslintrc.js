module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  ignorePatterns: ["**/node_modules/", "**/build/", "**/dist/"],
  rules: {
    "@typescript-eslint/ban-types": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["warn"],
    indent: [
      "error",
      2,
      { SwitchCase: 1, ignoredNodes: ["ConditionalExpression"] },
    ],
    "@typescript-eslint/ban-ts-comment": "off",
  },
  env: {
    node: true,
  },
};
