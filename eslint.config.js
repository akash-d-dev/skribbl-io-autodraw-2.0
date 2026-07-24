import js from "@eslint/js";
import globals from "globals";

export default [
    {
        ignores: [
            "dist/**",
            "node_modules/**",
            "cloudflare/**"
        ]
    },
    {
        files: ["webpack.config.cjs"],
        languageOptions: {
            sourceType: "commonjs",
            globals: globals.node
        }
    },
    js.configs.recommended,
    {
        files: ["src/**/*.js", "test/**/*.js", "dev/**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                chrome: "readonly"
            }
        },
        rules: {
            eqeqeq: ["error", "always"],
            "no-var": "error",
            "prefer-const": "error"
        }
    }
];
