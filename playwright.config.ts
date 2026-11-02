import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  use: {
    reducedMotion: "reduce",
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1200, height: 850 },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
