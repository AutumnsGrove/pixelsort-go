import { defineConfig } from '@playwright/test';

// PLAYWRIGHT_CHROMIUM_PATH lets a machine with a pre-installed Chromium skip `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	use: { baseURL: 'http://127.0.0.1:4173', launchOptions: { executablePath, args: ['--no-sandbox'] } },
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
	webServer: {
		command: 'pnpm build && pnpm preview',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
