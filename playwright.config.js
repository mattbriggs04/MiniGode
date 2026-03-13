import { defineConfig } from "@playwright/test";

const port = 4173;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      command: "node src/server.js",
      url: `${baseURL}/api/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        PORT: String(port)
      }
    };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer
});
