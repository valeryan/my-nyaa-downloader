import {
    defineConfig,
} from "eslint/config";

import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import { dirname } from "path";
import { fileURLToPath } from "url";

import {
    FlatCompat,
} from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([{
    languageOptions: {
        globals: {
            ...globals.browser,
        },

        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: {},
    },

    extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"),

    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    rules: {
        semi: ["error", "always"],
        // Enforce no file extensions in imports for TypeScript files
        "no-restricted-syntax": [
            "error",
            {
                "selector": "ImportDeclaration[source.value=/\\.(ts|tsx|js|jsx)$/]",
                "message": "Do not include file extensions in import statements. TSX can resolve them automatically."
            }
        ]
    },
}, {
    languageOptions: {
        globals: {
            ...globals.node,
        },

        sourceType: "script",
        parserOptions: {},
    },

    files: ["**/.eslint.config.{js,cjs,mjs}"],
}]);
