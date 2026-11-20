import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:3218",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: "bun run start --port 3218",
    url: "http://localhost:3218/login",
    reuseExistingServer: false,
    env: {
      PLAYGROUND_PASSWORD: "integration-test-password",
      AUTH_SECRET: "integration-test-secret-with-more-than-32-characters",
    },
  },
});
