import { expect, test } from '@playwright/test';

// a brand new visitor: nothing in storage
test.use({ storageState: { cookies: [], origins: [] } });

test('the tour starts on a first visit, highlights real elements, owns the keyboard, and is remembered', async ({
	page
}) => {
	await page.goto('/studio');
	const tour = page.getByTestId('tour');
	await expect(tour).toBeVisible();
	await expect(tour).toContainText('1 of 6');
	await page.keyboard.press('g'); // a shortcut behind the tour stays quiet
	await expect(page.getByTestId('strip')).toHaveCount(0);

	for (let step = 1; step < 6; step++) {
		await page.getByTestId('tour-next').click();
		await expect(tour).toContainText(`${step + 1} of 6`);
		const card = await tour.locator('.card').boundingBox();
		const vp = page.viewportSize()!;
		expect(card!.x).toBeGreaterThanOrEqual(0);
		expect(card!.y).toBeGreaterThanOrEqual(0);
		expect(card!.x + card!.width).toBeLessThanOrEqual(vp.width);
		expect(card!.y + card!.height).toBeLessThanOrEqual(vp.height);
	}
	await page.screenshot({ path: 'test-results/tour.png' });
	await page.getByTestId('tour-next').click(); // Done
	await expect(tour).toHaveCount(0);

	await page.reload();
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await expect(page.getByTestId('tour')).toHaveCount(0);
});

test('skipping also remembers, and Settings can start the tour again', async ({ page }) => {
	await page.goto('/studio');
	await page.getByTestId('tour-skip').click();
	await expect(page.getByTestId('tour')).toHaveCount(0);
	await page.goto('/settings');
	await page.getByTestId('take-tour').click();
	await expect(page.getByTestId('tour')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('tour')).toHaveCount(0);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	test('the card fits every step', async ({ page }) => {
		await page.goto('/studio');
		const tour = page.getByTestId('tour');
		await expect(tour).toBeVisible();
		for (let step = 0; step < 6; step++) {
			const card = await tour.locator('.card').boundingBox();
			expect(card!.x).toBeGreaterThanOrEqual(0);
			expect(card!.x + card!.width).toBeLessThanOrEqual(390);
			expect(card!.y + card!.height).toBeLessThanOrEqual(844);
			if (step < 5) await page.getByTestId('tour-next').click();
		}
	});
});
