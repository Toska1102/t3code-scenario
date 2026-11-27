import "vite-plus/test/config";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

// Mirror the repo's per-package pattern: inherit the root config minus its project list
// and minus the Node-only setup files, which this all-browser package cannot load.
const { run: _rootRunConfig, ...basePackageConfig } = baseConfig;
const {
  projects: _rootTestProjects,
  setupFiles: _rootSetupFiles,
  ...baseTestConfig
} = baseConfig.test ?? {};

const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.browser.test.{ts,tsx}"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
};

const browserTestProject = {
  extends: true,
  test: {
    name: "browser",
    include: ["src/**/*.browser.test.{ts,tsx}"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
    api: { port: 22_007, strictPort: false },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" as const }],
      screenshotFailures: false,
    },
  },
};

export default mergeConfig(
  { ...basePackageConfig, test: baseTestConfig },
  defineConfig({
    server: { proxy: { "/api": `http://127.0.0.1:${process.env.T3CODE_PORT ?? "3773"}` } },
    test: { projects: [unitTestProject, browserTestProject] },
  }),
);
