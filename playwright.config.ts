import { defineConfig, devices } from '@playwright/test';

// 端到端测试针对生产构建，并模拟 GitHub Pages 的 /<repository>/ 子路径
const BASE = '/PyAstVisualizer/';
const PORT = 4179;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    viewport: { width: 1600, height: 950 },
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 950 } } }],
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    env: { BASE_PATH: BASE },
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
