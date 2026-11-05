import { expect, test } from '@playwright/test';

test('Pro panel: cutting the picture into hexagons shows cells and sorts inside them', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('pro')).toBeVisible();
	await page.getByTestId('shape-hexagon').click();
	await expect(page.getByTestId('class-1')).toBeVisible();
	await expect(page.getByTestId('class-2')).toBeVisible();
	// the overlay is drawn from the engine's label map: some pixels are outlined
	await expect
		.poll(() =>
			page.getByTestId('overlay').evaluate((c: HTMLCanvasElement) => {
				const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
				let n = 0;
				for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
				return n;
			})
		)
		.toBeGreaterThan(1000);
	await page.getByLabel('Freeze kind 1').check();
	await expect(page.getByTestId('class-1')).toContainText('frozen');
	await page.waitForTimeout(600);
	await page.screenshot({ path: 'test-results/regions.png' });
	await page.getByTestId('shape-none').click();
	await expect(page.getByTestId('class-1')).toHaveCount(0);
});

test('Protect: the brightest spot becomes a shape that can be removed', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.keyboard.press('Tab');
	await expect(page.getByTestId('pro')).toBeVisible();
	await page.getByTestId('brightest').click();
	await expect(page.getByTestId('mask-object')).toHaveCount(1);
	await page.getByRole('button', { name: /^Remove/ }).click();
	await expect(page.getByTestId('mask-object')).toHaveCount(0);
});

test('hold T: the engine says which pixels can move, and the rest are veiled', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	const veiled = () =>
		page.getByTestId('overlay').evaluate((c: HTMLCanvasElement) => {
			const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
			let n = 0;
			for (let i = 3; i < d.length; i += 4) if (d[i] === 170) n++;
			return n / (d.length / 4);
		});
	// a threshold recipe only moves pixels inside its band, so the rest are held
	await page.getByTestId('k-preset').click();
	await page.locator('.pcard[data-p="kims"]').click();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('topread')).toContainText('threshold');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	expect(await veiled()).toBe(0); // nothing veiled until T is held
	await page.keyboard.down('t');
	await expect.poll(veiled).toBeGreaterThan(0.01); // the veil is drawn from the engine's own mask
	await page.screenshot({ path: 'test-results/what-can-move.png' });
	await page.keyboard.up('t');
	await expect.poll(veiled).toBe(0);
});
