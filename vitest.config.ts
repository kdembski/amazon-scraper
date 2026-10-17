import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@@tests": fileURLToPath(new URL("./tests", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    clearMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/support/integrationSetup.ts"],
          testTimeout: 15 * 1000,
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          globalSetup: ["tests/support/e2eGlobalSetup.ts"],
          testTimeout: 60 * 1000,
          hookTimeout: 60 * 1000,
        },
      },
      {
        extends: true,
        test: {
          name: "e2e-docker",
          include: ["tests/e2e/**/*.test.ts"],
          globalSetup: ["tests/support/e2eDockerGlobalSetup.ts"],
          env: { E2E_RUNTIME: "docker" },
          testTimeout: 60 * 1000,
          hookTimeout: 60 * 1000,
        },
      },
      {
        extends: true,
        test: {
          name: "live",
          include: ["tests/live/**/*.test.ts"],
          testTimeout: 3 * 60 * 1000,
          hookTimeout: 3 * 60 * 1000,
        },
      },
    ],
  },
});
