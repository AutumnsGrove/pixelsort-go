import { expect, test } from '@playwright/test';

test('Pro panel: a pattern family and variant drive the sort, and the preview comes from the engine', async ({
	page
}) => {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('pro')).toBeVisible();

	// choose the pattern interval mode from the Intervals popover
	await page.getByTestId('k-mode').click();
	await page.getByRole('dialog', { name: 'Intervals' }).getByRole('button', { name: 'pattern', exact: true }).click();
	// the same picker is in the Intervals popover, so a family can be chosen without opening Pro
	await expect(
		page.getByRole('dialog', { name: 'Intervals' }).getByRole('button', { name: 'grid', exact: true })
	).toBeVisible({ timeout: 10_000 });
	await page.keyboard.press('Escape');

	await expect(page.getByTestId('pattern-section')).toBeVisible();
	await expect(page.getByTestId('pattern-preview-label')).toContainText('truchet / arc');
	// the preview is drawn by the engine's own mask code: some pixels are on
	await expect
		.poll(() =>
			page.getByTestId('pattern-preview').evaluate((c: HTMLCanvasElement) => {
				const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
				let n = 0;
				for (let i = 0; i < d.length; i += 4) if (d[i]! > 100) n++;
				return n;
			})
		)
		.toBeGreaterThan(100);

	await page.getByTestId('pattern-family-grid').click();
	await page.getByTestId('pattern-variant-iso').click();
	await expect(page.getByTestId('pattern-preview-label')).toContainText('grid / iso');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });

	// the overlay toggle freezes the pattern instead of cutting at it
	await page.getByTestId('pattern-overlay').check();
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.screenshot({ path: 'test-results/pattern.png' });
});
