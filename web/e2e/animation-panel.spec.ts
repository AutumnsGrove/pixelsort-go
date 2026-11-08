import { expect, test, type Page } from '@playwright/test';

const waitDone = (page: Page) => expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });

async function openPanel(page: Page): Promise<void> {
	await page.goto('/studio');
	await waitDone(page);
	await page.getByTestId('animate').click();
	const panel = page.getByRole('dialog', { name: 'Animate' });
	await expect(panel).toBeVisible();
	await expect(page.getByTestId('anim-loading')).toHaveCount(0, { timeout: 30_000 });
}

/** Make the export small enough that a test finishes quickly. */
async function smallSettings(page: Page): Promise<void> {
	await page.getByRole('button', { name: '25%' }).click();
	await page.getByRole('button', { name: '2s' }).click();
	await page.getByRole('button', { name: '12 fps' }).click();
}

test('the animation panel previews frames and exports a GIF', async ({ page }) => {
	await openPanel(page);
	await smallSettings(page);
	await expect(page.getByTestId('anim-info')).toContainText('frames');

	const canvas = page.getByTestId('anim-canvas');
	await expect(canvas).toBeVisible();
	const nonBlank = await canvas.evaluate((c: HTMLCanvasElement) => {
		const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
		let sum = 0;
		for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
		return sum > 0 && c.width > 0;
	});
	expect(nonBlank).toBe(true);

	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('anim-export').click()]);
	expect(download.suggestedFilename()).toMatch(/-anim\.gif$/);
	await expect(page.getByTestId('anim-saved')).toContainText('.gif');
});

test('the animation panel exports an APNG at the chosen scale', async ({ page }) => {
	await openPanel(page);
	await smallSettings(page);
	await page.getByRole('radio', { name: 'APNG' }).click();
	await expect(page.getByTestId('anim-info')).toContainText('.apng');
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('anim-export').click()]);
	expect(download.suggestedFilename()).toMatch(/-anim\.apng$/);
});

test('the preview scrubs, plays and closes without disturbing the studio', async ({ page }) => {
	await openPanel(page);
	const before = await page.getByTestId('state').textContent();
	await page.getByTestId('anim-scrub').fill('3');
	await page.getByTestId('anim-play').click();
	await expect(page.getByTestId('anim-play')).toHaveAttribute('aria-label', 'Pause the preview');
	await page.getByTestId('anim-play').click();
	await page.getByTestId('anim-close').click();
	await expect(page.getByRole('dialog', { name: 'Animate' })).toHaveCount(0);
	await expect(page.getByTestId('state')).toHaveText(before ?? 'done');
});
