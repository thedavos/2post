import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.nitro/**",
      "**/.output/**",
      "**/.tanstack/**",
      "**/generated/**",
      "legacy/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Disabled: with SWC + NestJS DI, converting class imports to
      // `import type` erases design:paramtypes metadata and breaks
      // constructor injection at runtime (see CryptoService incident).
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
);
