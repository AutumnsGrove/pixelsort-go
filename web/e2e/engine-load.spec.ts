import { expect, test, type Page, type Route } from '@playwright/test';

const waitDone = (page: Page) => expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });

/** Fails the first `n` downloads of engine.wasm the way a dropped connection does, then lets the rest through. */
async function dropFirst(page: Page, n: number): Promise<{ count: () => number }> {
	let seen = 0;
	await page.route('**/engine.wasm', async (route: Route) => {
		seen++;
		if (seen <= n) await route.abort('connectionreset');
		else await route.continue();
	});
	return { count: () => seen };
}

test('one dropped download is retried by itself and the person never sees a dialog', async ({ page }) => {
	const hits = await dropFirst(page, 1);
	await page.goto('/studio');
	await waitDone(page);
	expect(hits.count()).toBe(2);
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('while the engine downloads the page says so instead of sitting silent', async ({ page }) => {
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route('**/engine.wasm', async (route) => {
		await held;
		await route.continue();
	});
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText(/loading the engine/);
	release();
	await waitDone(page);
});

test('two failed downloads show the download message, and Try again restarts the worker, keeping the picture and the name', async ({
	page
}) => {
	const hits = await dropFirst(page, 2);
	await page.goto('/studio');
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible({ timeout: 30_000 });
	await expect(dialog).toContainText('didn’t finish downloading');
	await expect(dialog).not.toContainText('didn’t start');
	expect(hits.count()).toBe(2);
	// the picture is still on screen behind the dialog (the sample was decoded before the engine was asked for anything)
	const painted = await page.getByTestId('stage').evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let lit = 0;
		for (let i = 0; i < d.length; i += 4 * 97) if (d[i]! + d[i + 1]! + d[i + 2]! > 40) lit++;
		return lit;
	});
	expect(painted).toBeGreaterThan(50);
	await dialog.getByRole('button', { name: 'Try again' }).click();
	await expect(dialog).toHaveCount(0);
	await waitDone(page);
	expect(hits.count()).toBe(3);
});
