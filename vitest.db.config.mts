import path from "node:path";
import { defineConfig } from "vitest/config";

// DB integration tests: `npm run test:db`. MONGODB_DB must contain "test".
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/db/setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});
