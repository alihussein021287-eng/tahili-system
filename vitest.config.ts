import { defineConfig } from "vitest/config";
import path from "path";

const include = ["tests/unit/**/*.test.ts"];
if (process.env.AUTH_VERSION_INTEGRATION === "1") include.push("tests/integration/**/*.test.ts");

export default defineConfig({
  test: {
    environment: "node",
    include,
    // Database integration files share one PostgreSQL and use Serializable transactions: run them one file at a time
    // so serialization conflicts (P2034) between files cannot make assertions flaky.
    fileParallelism: process.env.AUTH_VERSION_INTEGRATION === "1" ? false : true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
