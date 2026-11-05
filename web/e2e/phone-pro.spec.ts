import { expect, test, type Page } from '@playwright/test';

// The Pro panel on a phone (390x844): a bottom sheet with Shapes and Protect tabs, big targets, nothing overflowing.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function openSheet(page: Page): Promise<void> {
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('pro')).toBeVisible();
}

/** Every visible control inside the sheet that is smaller than a thumb. */
const small = (page: Page) =>
	page.getByTestId('pro').evaluate((sheet) => {
		const out: string[] = [];
		const box = sheet.getBoundingClientRect();
		for (const el of sheet.querySelectorAll<HTMLElement>('button, select, input, summary, textarea')) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (r.bottom < box.top || r.top > box.bottom) continue;
			if (el instanceof HTMLInputElement && el.type === 'checkbox') {
				// a switch is tapped through its label row, which must be 44 px tall
				const row = el.closest('label, .row, .tog');
				if (row && row.getBoundingClientRect().height >= 43.5) continue;
			}
			if (r.height < 43.5)
				out.push(
					`${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20)}] ${Math.round(r.height)}px`
				);
		}
		return out;
	});

test('the Pro panel is a bottom sheet with two tabs, and the picture stays in view', async ({ page }) => {
	await openSheet(page);
	await expect(page.getByRole('tablist', { name: 'Pro panel sections' })).toBeVisible();
	await expect(page.getByTestId('tab-shapes')).toHaveAttribute('aria-selected', 'true');
	const sheet = (await page.getByTestId('pro').boundingBox())!;
	const stage = (await page.getByTestId('stage').boundingBox())!;
	expect(sheet.y, 'the sheet leaves the top of the screen free').toBeGreaterThan(300);
	expect(stage.y + stage.height, 'the whole picture is above the sheet').toBeLessThanOrEqual(sheet.y + 1);
	expect(stage.height, 'and still a useful size').toBeGreaterThan(120);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await page.screenshot({ path: 'test-results/phone-shapes.png' });
});

test('Shapes tab: tiles, starters and region cards; Protect tab: the mask tools', async ({ page }) => {
	await openSheet(page);
	await page.getByTestId('shape-hexagon').tap();
	await expect(page.getByTestId('class-1')).toBeVisible();
	await expect(page.getByTestId('starter-Ring')).toBeVisible();
	await expect(page.getByTestId('add-ellipse')).toHaveCount(0);
	await page.getByTestId('tab-protect').tap();
	await expect(page.getByTestId('tab-protect')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByTestId('add-ellipse')).toBeVisible();
	await expect(page.getByTestId('shape-hexagon')).toHaveCount(0);
	await page.getByTestId('add-ellipse').tap();
	await expect(page.getByTestId('mask-object')).toHaveCount(1);
	await page.screenshot({ path: 'test-results/phone-protect.png' });
	await page.getByTestId('tab-shapes').tap();
	await expect(page.getByTestId('class-1')).toBeVisible(); // the choices survive switching tabs
});

test('every target in the sheet is at least 44 px', async ({ page }) => {
	await openSheet(page);
	await page.getByTestId('shape-hexagon').tap();
	await page.getByTestId('class-1-head').tap();
	await page.getByRole('switch', { name: 'Own cutting for kind 1' }).check();
	expect(await small(page), 'Shapes tab').toEqual([]);
	await page.getByTestId('tab-protect').tap();
	await page.getByTestId('add-ellipse').tap();
	expect(await small(page), 'Protect tab').toEqual([]);
});
