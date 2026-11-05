import { expect, test } from '@playwright/test';
import { makePng } from './png';

const DAY = 86400;
const N = 2000;
const runs = Array.from({ length: N }, (_, i) => ({
	id: i + 1,
	created_at: Math.floor(Date.now() / 1000) - i * (DAY / 20), // twenty runs a day, newest first
	original: { sha256: 'a'.repeat(64), mime: 'image/png', w: 16, h: 16, bytes: 1 },
	result: { sha256: 'b'.repeat(64), mime: 'image/png', w: 16, h: 16, bytes: 1 },
	thumb: { sha256: 'c'.repeat(64), mime: 'image/png', w: 8, h: 8, bytes: 1 },
	settings: { mode: i % 2 ? 'threshold' : 'random', angle: 90, length: 40 },
	seed: i,
	engine_version: '1',
	duration_ms: 1,
	parent_run_id: null,
	starred: false,
	title: i === 1234 ? 'Needle in a haystack' : `Run ${i + 1}`,
	notes: null,
	trashed_at: null,
	tags: []
}));

test('the runs strip (G): a window of 2000 runs, search, a far jump, and opening one restores its recipe', async ({
	page
}) => {
	await page.route('**/api/runs?**', (r) => r.fulfill({ json: { runs, next_cursor: null } }));
	await page.route('**/api/images/**', (r) => r.fulfill({ body: makePng(1, 16), contentType: 'image/png' }));
	await page.goto('/studio');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 20_000 });
	await page.keyboard.press('g');
	await expect(page.getByTestId('strip')).toBeVisible();
	await expect(page.getByTestId('strip-run').first()).toBeVisible();

	// only a window of the 2000 rows is in the DOM
	expect(await page.getByTestId('strip-run').count()).toBeLessThan(40);

	// search narrows
	await page.getByRole('searchbox', { name: 'Search runs' }).fill('needle');
	await expect(page.getByTestId('strip-run')).toHaveCount(1);
	await expect(page.getByTestId('strip-run')).toContainText('Needle in a haystack');

	// opening it restores its recipe (run 1235 is index 1234: even index, so "random") and its name
	await page.getByTestId('strip-run').click();
	await expect(page.getByTestId('name')).toHaveText('Needle in a haystack', { timeout: 20_000 });
	await expect(page.getByTestId('k-mode')).toHaveText('random');
	await expect(page.getByTestId('k-angle')).toHaveText('90°');

	// a far jump is instant: the last date group lands in view
	await page.getByRole('searchbox', { name: 'Search runs' }).fill('');
	const rail = page.getByRole('navigation', { name: 'Jump to a date' }).getByRole('button');
	await rail.last().click();
	await expect.poll(() => page.getByTestId('strip-scroll').evaluate((e) => e.scrollTop)).toBeGreaterThan(5000);
	await expect(page.getByTestId('strip-run').first()).toBeVisible();
	await page.screenshot({ path: 'test-results/strip.png' });
});
