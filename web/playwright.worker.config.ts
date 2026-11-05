import { defineConfig } from '@playwright/test';

// Drives the real share Worker (wrangler dev, local) from the real Go server: no mocks. Run with `pnpm e2e:worker`.
// Needs `pnpm --dir worker install` and Go on the PATH.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const SECRET = 'e2e-secret';
const dataDir = process.env.E2E_DATA_DIR || `/tmp/pixelsort-e2e-${process.pid}`;

export default defineConfig({
	testDir: 'e2e-worker',
	timeout: 60_000,
	workers: 1,
	use: { baseURL: 'http://127.0.0.1:8896', launchOptions: { executablePath, args: ['--no-sandbox'] } },
	projects: [{ name: 'worker', use: { browserName: 'chromium' } }],
	webServer: [
		{
			command: `pnpm --dir ../worker exec wrangler dev --local --port 8787 --var SHARED_SECRET:${SECRET} --persist-to ${dataDir}/r2`,
			port: 8787,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000
		},
		{
			command: 'go run ../cmd/pixelsort-go serve',
			url: 'http://127.0.0.1:8896/healthz',
			reuseExistingServer: !process.env.CI,
			timeout: 180_000,
			env: {
				PIXELSORT_ADDR: '127.0.0.1:8896',
				PIXELSORT_DATA: `${dataDir}/data`,
				PIXELSORT_WORKER_URL: 'http://127.0.0.1:8787',
				PIXELSORT_WORKER_SECRET: SECRET
			}
		}
	]
});
