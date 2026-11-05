import { expect, test } from '@playwright/test';

test('home names the app, leads to Studio, and links the other screens', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('home')).toBeVisible();
	await expect(page.getByRole('heading', { name: /watch the sort happen/i })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Open Studio' })).toHaveAttribute('href', '/studio');
	await expect(page.getByRole('link', { name: 'Archive', exact: true }).first()).toBeVisible();
	await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible();
});

test('Open Studio really opens the engine', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'Open Studio' }).click();
	await expect(page).toHaveURL(/\/studio$/);
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
});
