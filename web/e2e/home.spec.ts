import { expect, test } from '@playwright/test';

test('home shows the app name and a link to the lab', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'pixelsort-go' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Open the lab' })).toHaveAttribute('href', '/lab');
});
