import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    setupFiles: ["tests/setup-env.ts"],
    // Los tests de integración comparten una base de datos: se ejecutan en serie.
    fileParallelism: false,
  },
});
