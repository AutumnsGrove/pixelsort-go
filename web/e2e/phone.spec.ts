import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('Studio on a phone: nothing overflows, targets are 44 px, popovers open as sheets', async ({ page }) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });

	// no sideways scroll on the page itself
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);

	// the dock sits inside the screen
	const dock = await page.getByRole('toolbar', { name: 'Controls' }).boundingBox();
	expect(dock).not.toBeNull();
	expect(dock!.x).toBeGreaterThanOrEqual(0);
	expect(dock!.x + dock!.width).toBeLessThanOrEqual(390 + 0.5);
	expect(dock!.y + dock!.height).toBeLessThanOrEqual(844);

	// every dock button is at least 44 x 44
	for (const b of await page.getByRole('toolbar', { name: 'Controls' }).getByRole('button').all()) {
		const box = await b.boundingBox();
		expect(box!.height, await b.innerText()).toBeGreaterThanOrEqual(43.5);
		expect(box!.width).toBeGreaterThanOrEqual(43.5);
	}

	// a popover opens inside the screen, above the dock
	await page.getByTestId('k-mode').click();
	const pop = await page.getByRole('dialog', { name: 'Intervals' }).boundingBox();
	expect(pop).not.toBeNull();
	expect(pop!.x).toBeGreaterThanOrEqual(0);
	expect(pop!.x + pop!.width).toBeLessThanOrEqual(390 + 0.5);
	expect(pop!.y + pop!.height).toBeLessThanOrEqual(dock!.y + 1);
	await page.screenshot({ path: 'test-results/phone-studio.png' });
	await page.keyboard.press('Escape');

	// the picture itself fits
	const stage = await page.getByTestId('stage').boundingBox();
	expect(stage!.x + stage!.width).toBeLessThanOrEqual(390 + 0.5);
});

test('Archive and Settings fit a phone too', async ({ page }) => {
	for (const path of ['/archive', '/settings']) {
		await page.goto(path);
		await page.waitForTimeout(300);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, path).toBeLessThanOrEqual(0);
	}
});
