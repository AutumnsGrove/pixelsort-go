import { expect, test, type Page } from '@playwright/test';

const waitDone = (page: Page) => expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });

test('Studio loads a sample, applies a preset, and the readout follows', async ({ page }) => {
	await page.goto('/studio');
	await waitDone(page);
	await page.getByTestId('k-preset').click();
	await page.locator('.pcard[data-p="kims"]').click();
	await expect(page.getByTestId('k-angle')).toHaveText('90°');
	await expect(page.getByTestId('k-mode')).toHaveText('threshold');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('topread')).toContainText('threshold');
});

test('keyboard: space plays and finishes, ? opens the sheet, Esc closes it, F2 renames', async ({ page }) => {
	await page.goto('/studio');
	await waitDone(page);
	await page.keyboard.press('?');
	await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
	await page.keyboard.press('F2');
	await page.getByTestId('name-input').fill('  My   ridge \n');
	await page.getByTestId('name-input').press('Enter');
	await expect(page.getByTestId('name')).toHaveText('My ridge');
	await page.keyboard.press('Space');
	await expect(page.getByTestId('state')).toHaveText(/pass|done/);
});

test('the angle dial: typing sets the angle and arrow keys step', async ({ page }) => {
	await page.goto('/studio');
	await waitDone(page);
	await page.getByTestId('k-angle').click();
	await page.getByTestId('angle-input').fill('45');
	await expect(page.getByTestId('k-angle')).toHaveText('45°');
	await page.getByTestId('dial').focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByTestId('k-angle')).toHaveText('46°');
	await page.keyboard.press('Shift+ArrowRight');
	await expect(page.getByTestId('k-angle')).toHaveText('61°');
});

test('a text file shows the "isn’t a picture" dialog and leaves the picture alone', async ({ page }) => {
	await page.goto('/studio');
	await waitDone(page);
	await page
		.getByTestId('file')
		.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
	const d = page.getByRole('alertdialog');
	await expect(d).toContainText('notes.txt');
	await expect(d).toContainText('untouched');
});

test('export: the dialog names the file and downloads it', async ({ page }) => {
	await page.goto('/studio');
	await waitDone(page);
	await page.keyboard.press('e');
	await expect(page.getByTestId('export-info')).toContainText('.png');
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-go').click()]);
	expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+\.png$/);
});

test('settings: turning grain off hides the grain layer and survives a reload', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.locator('.grain')).toBeVisible();
	await page.getByTestId('grain').uncheck();
	await expect(page.locator('html')).toHaveAttribute('data-grain', 'off');
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-grain', 'off');
});

test('every request stays on this origin and fonts load', async ({ page }) => {
	const foreign: string[] = [];
	page.on('request', (r) => {
		if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:') && !r.url().startsWith('blob:'))
			foreign.push(r.url());
	});
	await page.goto('/studio');
	await waitDone(page);
	expect(foreign).toEqual([]);
	expect(await page.evaluate(() => document.fonts.check("italic 16px 'Instrument Serif'"))).toBe(true);
});

test('Archive lists runs from the API, stars and trashes them', async ({ page }) => {
	const run = {
		id: 1,
		created_at: Math.floor(Date.now() / 1000),
		title: null,
		starred: false,
		settings: { mode: 'wave', seed: 3 },
		seed: 3,
		result: { sha256: 'a'.repeat(64), bytes: 10 },
		thumb: { sha256: 'b'.repeat(64), bytes: 1 }
	};
	let trashed = false;
	await page.route('**/api/runs?**', (r) => r.fulfill({ json: { runs: trashed ? [] : [run], next_cursor: null } }));
	await page.route('**/api/usage', (r) =>
		r.fulfill({ json: { used_bytes: 1e9, budget_bytes: 50 * 2 ** 30, trash_bytes: 0, runs: 1, trash_runs: 0 } })
	);
	await page.route('**/api/runs/1', (r) => {
		run.starred = true;
		return r.fulfill({ json: run });
	});
	await page.route('**/api/runs/trash', (r) => {
		trashed = true;
		return r.fulfill({ json: { trashed: [1], missing: [] } });
	});
	await page.route('**/api/images/*', (r) => r.fulfill({ status: 404, body: '' }));
	await page.goto('/archive');
	await expect(page.getByTestId('run')).toHaveCount(1);
	await expect(page.getByTestId('usage')).toContainText('of 50 GB');
	await page.getByRole('button', { name: /^Star/ }).click({ force: true });
	await expect(page.getByRole('button', { name: /^Unstar/ })).toHaveCount(1);
	await page.getByRole('button', { name: /bin$/ }).click({ force: true });
	await expect(page.getByTestId('empty')).toContainText('Nothing sorted yet.');
});
