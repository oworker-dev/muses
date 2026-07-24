import { defineConfig } from "@playwright/test"

const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.OWORKER_WEB_URL || "http://127.0.0.1:3000",
    channel: browserChannel,
    trace: "retain-on-failure",
  },
})
