// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/src-tauri/target/**", "**/coverage/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    }
  },
  {
    // L'argent n'est jamais un flottant (§9) : interdit dans le moteur de devis.
    files: ["packages/quote-engine/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[raw=/^\\d+\\.\\d+$/]",
          message: "Pas de littéral flottant dans quote-engine : centimes entiers (Cents) ou points de base."
        }
      ]
    }
  }
);
