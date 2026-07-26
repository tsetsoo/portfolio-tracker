import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // The real "server-only" package throws when imported outside of a
      // React Server Component build; stub it out so server-only modules
      // remain testable under plain Node/Vitest.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
