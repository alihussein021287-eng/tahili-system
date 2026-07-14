import { defineConfig } from "vitest/config";
import path from "path";

const include = ["tests/unit/**/*.test.ts"];
if (process.env.AUTH_VERSION_INTEGRATION === "1") include.push("tests/integration/**/*.test.ts");

export default defineConfig({
  test: {
    environment: "node",
    include,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
