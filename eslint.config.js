const next = require("@next/eslint-plugin-next");
const react = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");
const jsxA11y = require("eslint-plugin-jsx-a11y");
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

module.exports = [
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/out/**",
      "eslint.config.js",
      "next.config.js",
      "postcss.config.js",
      "tailwind.config.ts",
      "scripts/**"
    ]
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    settings: {
      react: {
        version: "detect"
      }
    },
    plugins: {
      "@next/next": next,
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      "@typescript-eslint": tsPlugin
    },
    rules: {
      ...(next.configs.recommended && next.configs.recommended.rules ? next.configs.recommended.rules : {}),
      ...(next.configs["core-web-vitals"] && next.configs["core-web-vitals"].rules ? next.configs["core-web-vitals"].rules : {}),
      ...(reactHooks.configs.recommended && reactHooks.configs.recommended.rules ? reactHooks.configs.recommended.rules : {}),
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off"
    }
  }
];
