import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Isolated data directory for the e2e run. The path is also surfaced
// to test code via the MEMORIAM_E2E_DATA_DIR env var so helpers can
// open the platform SQLite directly (e.g. to read magic-link tokens
// instead of dispatching real email).
const dataDir = process.env.MEMORIAM_E2E_DATA_DIR || join(here, '.e2e-data');
process.env.MEMORIAM_E2E_DATA_DIR = dataDir;

export default defineConfig({
	testDir: './e2e',
	testMatch: /.*\.e2e\.ts$/,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 1,
	reporter: 'list',
	globalSetup: './e2e/helpers/global-setup.ts',
	use: {
		baseURL: 'http://127.0.0.1:5174',
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		command: `bun run dev -- --host 127.0.0.1 --port 5174`,
		port: 5174,
		reuseExistingServer: !process.env.CI,
		env: {
			DATA_DIR: dataDir,
			NODE_ENV: 'development'
		},
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 60_000
	}
});
