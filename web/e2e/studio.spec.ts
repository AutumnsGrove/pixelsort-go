import { expect, test, type Page } from '@playwright/test';
import { makePng } from './png';

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

test('load from a link: a CORS-blocked site goes through the relay; a page that is not a picture says so', async ({
	page
}) => {
	const png = makePng(1, 8);
	await page.route('**/api/features', (r) => r.fulfill({ json: { share: true, fetch: true } }));
	// the site refuses a browser (no CORS headers)
	await page.route('https://pics.example/**', (r) => r.abort('failed'));
	let relayed = '';
	await page.route('**/api/fetch', (r) => {
		relayed = r.request().postDataJSON().url;
		return relayed.endsWith('page.html')
			? r.fulfill({ status: 415, json: { error: { code: 'link-not-image', message: 'x' } } })
			: r.fulfill({ body: png, contentType: 'image/png' });
	});
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });

	await page.getByTestId('link-open').click();
	await page.getByTestId('link-input').fill('https://pics.example/ridge.png');
	await page.getByRole('button', { name: 'Load', exact: true }).click();
	await expect(page.getByTestId('topread')).toContainText('8×8', { timeout: 20_000 }); // the relayed picture is now loaded
	expect(relayed).toBe('https://pics.example/ridge.png');

	await page.getByTestId('link-open').click();
	await page.getByTestId('link-input').fill('https://pics.example/page.html');
	await page.getByRole('button', { name: 'Load', exact: true }).click();
	await expect(page.getByRole('alertdialog')).toContainText('That link isn’t a picture.');
	await page.getByRole('button', { name: 'Try another link' }).click();
	await expect(page.getByTestId('link-input')).toBeVisible();
});

test('naming: Esc undoes, Save and Auto work, the export file name is shown, and the box clears the dock at four sizes', async ({
	page
}) => {
	await page.goto('/studio');
	await waitDone(page);
	const original = (await page.getByTestId('name').innerText()).trim();

	await page.getByTestId('name').click();
	await page.getByTestId('name-input').fill('Throwaway');
	await page.getByTestId('name-input').press('Escape');
	await expect(page.getByTestId('name')).toHaveText(original); // undone

	await page.getByTestId('name').click();
	await page.getByTestId('name-input').fill('<b>Bold</b> ridge');
	await expect(page.getByTestId('name-file')).toContainText('ridge'); // the file name it will export as
	await page.getByTestId('name-save').click();
	await expect(page.getByTestId('name')).toHaveText('<b>Bold</b> ridge'); // markup is text, not markup
	await expect(page.locator('b', { hasText: 'Bold' })).toHaveCount(0);

	await page.getByTestId('name').click();
	await page.getByTestId('name-auto').click();
	await expect(page.getByTestId('name')).toHaveText(original); // empty goes back to the automatic name

	for (const [w, h] of [
		[1440, 900],
		[1280, 720],
		[768, 1024],
		[390, 844]
	] as const) {
		await page.setViewportSize({ width: w, height: h });
		await page.getByTestId('name').click();
		const box = await page.getByTestId('name-input').boundingBox();
		const dock = await page.getByRole('toolbar', { name: 'Controls' }).boundingBox();
		expect(box!.y + box!.height, `${w}x${h}`).toBeLessThanOrEqual(dock!.y + 1);
		await page.getByTestId('name-input').press('Escape');
	}
});
