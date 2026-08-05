import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  // Temporary S24 migration gate: stop on the first stale contract in the remaining files.
  maxFailures: 1,
  testIgnore: [
    /adaptive-scroll\.spec\.ts/,
    /capture-hardening\.spec\.ts/,
    /capture-reset\.spec\.ts/,
    /element-selection\.spec\.ts/,
    /full-page-capture\.spec\.ts/,
    /page-preparation\.spec\.ts/,
    /pdf-editor\.spec\.ts/,
    /pdf-export\.spec\.ts/,
    /pdf-source\.spec\.ts/,
    /region-selection\.spec\.ts/,
    /region-selector-accessibility\.spec\.ts/,
    /scroll-area\.spec\.ts/,
    /scroll-fallback-long\.spec\.ts/,
  ],
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
      name: "visible-smoke",
      grep: /@smoke/,
      use: { deviceScaleFactor: 1 },
    },
    {
      name: "visible-dpr2-zoom125",
      grep: /@dpr/,
      use: { deviceScaleFactor: 2 },
    },
    {
      name: "release-matrix-dpr1",
      grep: /@release-matrix/,
      use: { deviceScaleFactor: 1 },
    },
    {
      name: "release-matrix-dpr15",
      grep: /@release-matrix/,
      use: { deviceScaleFactor: 1.5 },
    },
    {
      name: "release-matrix-dpr2",
      grep: /@release-matrix/,
      use: { deviceScaleFactor: 2 },
    },
  ],
});
