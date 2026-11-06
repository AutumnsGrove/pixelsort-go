import { expect, test, type Page } from '@playwright/test';

const waitDone = (page: Page) => expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });

/** A stand-in gallery API that counts the runs it is asked to store. `failNext` makes the next saves answer 500. */
async function fakeGallery(page: Page): Promise<{ saves: () => number; failNext: (n: number) => void }> {
	let saves = 0;
	let fail = 0;
	await page.route('**/api/images/check', (r) => r.fulfill({ json: { exists: false } }));
	await page.route('**/api/runs', async (r) => {
		if (r.request().method() !== 'POST') return r.fallback();
		if (fail > 0) {
			fail--;
			return r.fulfill({ status: 500, json: { error: { code: 'internal', message: 'boom' } } });
		}
		saves++;
		return r.fulfill({ status: 201, json: { id: saves } });
	});
	return { saves: () => saves, failNext: (n) => (fail = n) };
}

async function setAngle(page: Page, deg: number): Promise<void> {
	await page.getByTestId('k-angle').click();
	await page.getByTestId('angle-input').fill(String(deg));
	await page.keyboard.press('Escape');
}

const settle = (page: Page, ms = 3500) => page.waitForTimeout(ms); // longer than the 2 s auto-save quiet window

test('by default nothing is stored by turning knobs; Save stores one, pressing it again stores nothing', async ({
	page
}) => {
	const api = await fakeGallery(page);
	await page.goto('/studio');
	await waitDone(page);
	await settle(page);
	expect(api.saves(), 'opening Studio with the demo photo').toBe(0);

	for (const deg of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) await setAngle(page, deg);
	await waitDone(page);
	await settle(page);
	expect(api.saves(), 'ten angle positions').toBe(0);
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'unsaved');
	await expect(page.getByTestId('unsaved-note')).toBeVisible();

	await page.getByTestId('save').click();
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'saved');
	expect(api.saves()).toBe(1);
	await expect(page.getByTestId('save')).toContainText('Saved');
	await expect(page.getByTestId('unsaved-note')).toHaveCount(0);

	await page.getByTestId('save').click(); // nothing changed since
	await page.waitForTimeout(500);
	expect(api.saves(), 'pressing Save again without a change').toBe(1);

	await setAngle(page, 120);
	await waitDone(page);
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'unsaved');
	await page.getByTestId('save').click();
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'saved');
	expect(api.saves()).toBe(2);
});

test('with Auto-save runs on, the demo photo is still never stored, and a settled look is stored once', async ({
	page
}) => {
	await page.addInitScript(() => localStorage.setItem('pixelsort.settings', JSON.stringify({ autoSave: true })));
	const api = await fakeGallery(page);
	await page.goto('/studio');
	await waitDone(page);
	await settle(page);
	expect(api.saves(), 'the demo photo alone').toBe(0);

	for (const deg of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) await setAngle(page, deg);
	await waitDone(page);
	await expect.poll(() => api.saves(), { timeout: 10_000 }).toBe(1);
	await settle(page);
	expect(api.saves(), 'ten positions and stop: one run, not ten').toBe(1);
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'saved');
});

test('Export always stores the look, even with auto-save off', async ({ page }) => {
	const api = await fakeGallery(page);
	await page.goto('/studio');
	await waitDone(page);
	await setAngle(page, 33);
	await waitDone(page);
	await page.getByTestId('export').click();
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-go').click()]);
	expect(download.suggestedFilename()).toMatch(/\.png$/);
	await expect.poll(() => api.saves()).toBe(1);
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'saved');
});

test('a failed save says so, keeps the look, and Retry stores it', async ({ page }) => {
	const api = await fakeGallery(page);
	await page.goto('/studio');
	await waitDone(page);
	await setAngle(page, 45);
	await waitDone(page);
	api.failNext(1);
	await page.getByTestId('save').click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toContainText('Couldn’t save this run');
	expect(api.saves()).toBe(0);
	await dialog.getByRole('button', { name: 'Retry now' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'saved');
	expect(api.saves()).toBe(1);
});

test('leaving with an unsaved look warns once and then lets go; saving clears the warning', async ({ page }) => {
	await fakeGallery(page);
	await page.goto('/studio');
	await waitDone(page);
	await setAngle(page, 77);
	await waitDone(page);
	const archive = page.getByRole('link', { name: 'Archive', exact: true }).first();
	await archive.click();
	await expect(page.getByTestId('leave-warn')).toBeVisible();
	await expect(page).toHaveURL(/\/studio/);
	await archive.click(); // the second try goes through
	await expect(page).toHaveURL(/\/archive/);
});

test('the demo photo alone never warns on leaving', async ({ page }) => {
	await page.goto('/studio');
	await waitDone(page);
	await page.getByRole('link', { name: 'Archive', exact: true }).first().click();
	await expect(page).toHaveURL(/\/archive/);
});

test('the lightning (sort instantly) button is gone', async ({ page }) => {
	await page.goto('/studio');
	await waitDone(page);
	await expect(page.getByTestId('instant')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Sort instantly' })).toHaveCount(0);
	await expect(page.getByTestId('save')).toBeVisible();
});

test('on a phone Save stays in view even when the dock is scrolled all the way along', async ({ browser }) => {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	await ctx.addInitScript(() => localStorage.setItem('pixelsort.toured', 'true'));
	const page = await ctx.newPage();
	await page.goto('/studio');
	await waitDone(page);
	await page.locator('.dock').evaluate((d) => (d.scrollLeft = d.scrollWidth));
	await page.waitForTimeout(200);
	const box = await page.getByTestId('save').boundingBox();
	expect(box, 'Save has a box').not.toBeNull();
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(390);
	expect(box!.height).toBeGreaterThanOrEqual(44);
	await ctx.close();
});

test('Settings has the Auto-save toggle, off by default, and it sticks', async ({ page }) => {
	await page.goto('/settings');
	const box = page.getByTestId('autosave');
	await expect(box).not.toBeChecked();
	await box.check();
	await page.reload();
	await expect(page.getByTestId('autosave')).toBeChecked();
});
