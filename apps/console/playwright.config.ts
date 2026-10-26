import { defineConfig } from "@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "python -m horus_workspace.server --port 3100",
      cwd: path.resolve(__dirname, "../.."),
      url: "http://127.0.0.1:3100/api/health",
      reuseExistingServer: !!process.env.HORUS_REUSE_SERVER,
      env: { DATABASE_PATH: "artifacts/e2e.db" },
    },
  ],
});
