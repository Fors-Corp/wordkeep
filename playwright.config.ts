import { defineConfig, devices } from '@playwright/test'

const apiPort = process.env.E2E_API_PORT ?? '3011'
const webPort = process.env.E2E_WEB_PORT ?? '5174'
const dbPath = process.env.WORDKEEP_E2E_DB ?? '/tmp/wordkeep-e2e.db'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `rm -f ${dbPath}* && WORDKEEP_DB=${dbPath} PORT=${apiPort} WORDKEEP_SKIP_WARMUP=1 npm run start -w server`,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `VITE_API_PROXY=http://127.0.0.1:${apiPort} npm run dev -w client -- --port ${webPort} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
