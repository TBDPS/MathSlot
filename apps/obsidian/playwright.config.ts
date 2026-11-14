import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type * as PlaywrightTest from '../desktop/node_modules/@playwright/test/index';

const require = createRequire(import.meta.url);
const { defineConfig } = require('../desktop/node_modules/@playwright/test/index.js') as typeof PlaywrightTest;

function resolveChromiumExecutable(): string | undefined {
  if (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE &&
    existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
  ) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }
  const cacheDir = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cacheDir)) {
    const dirs = readdirSync(cacheDir)
      .filter((name) => name.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const candidate = join(cacheDir, dir, 'chrome-linux64', 'chrome');
      if (existsSync(candidate)) {
        return candidate;
      }
      const legacyCandidate = join(cacheDir, dir, 'chrome-linux', 'chrome');
      if (existsSync(legacyCandidate)) {
        return legacyCandidate;
      }
    }
  }
  if (existsSync('/usr/bin/chromium-browser')) {
    return '/usr/bin/chromium-browser';
  }
  if (existsSync('/usr/bin/chromium')) {
    return '/usr/bin/chromium';
  }
  return undefined;
}

const executablePath = resolveChromiumExecutable();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'off',
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: 'npx vite --config vite.e2e.config.ts --host 127.0.0.1 --port 4174',
    port: 4174,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
