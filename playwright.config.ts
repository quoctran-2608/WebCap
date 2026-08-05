import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node tests/e2e/fixture-server.mjs",
    url: "http://127.0.0.1:4174/visible-capture.html",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
  projects: [
    {
      name: "s24-full-page-diagnostic",
      grep: /captures a multi-tile full page/,
      use: { deviceScaleFactor: 1 },
    },
  ],
});
