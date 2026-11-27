// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite config runs before any Effect runtime.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "vite-plus/test/browser-playwright";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.browser.test.{ts,tsx}"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
} satisfies TestProjectInlineConfiguration;

// Pre-bundle lazy browser entries to avoid mid-run reloads (same as apps/web).
const browserTestProject = {
  extends: true,
  optimizeDeps: {
    include: ["vite-plus/test/browser"],
  },
  test: {
    name: "browser",
    include: ["src/**/*.browser.test.{ts,tsx}"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
    api: { port: 23_457, strictPort: false },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
    },
  },
} satisfies TestProjectInlineConfiguration;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": `http://127.0.0.1:${process.env.T3CODE_PORT ?? "3773"}` } },
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom"] },
  test: {
    projects: [defineProject(unitTestProject), defineProject(browserTestProject)],
  },
});
