import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makePng } from './png';

const sha = (c: string) => c.repeat(64);

type Run = Record<string, unknown> & { id: number; title: string | null; settings: Record<string, unknown> };
const img = (c: string) => ({ sha256: sha(c), mime: 'image/png', w: 8, h: 8, bytes: 120 });
const base = (id: number): Run => ({
	id,
	created_at: Math.floor(Date.now() / 1000) - 3600,
	original: img('a'),
	result: img('b'),
	thumb: img('c'),
	seed: 7,
	engine_version: '1',
	duration_ms: 12,
	parent_run_id: null,
	starred: false,
	title: null,
	notes: null,
	trashed_at: null,
	tags: [],
	settings: {}
});

/** A look with cells, a custom-free hexagon tiling and a protected shape: what "Open in Studio" must bring back whole. */
const RIDGE: Run = {
	...base(7),
	title: 'Ridge study',
	settings: {
		mode: 'wave',
		angle: 30,
		length: 60,
		key: 'hue',
		seed: 7,
		regions: { tiling: { shape: 'hexagon', size: 90, gap: 6, rotate: 0, seed: 7, pattern: 'checker', kinds: 3 } },
		mask: {
			objects: [{ kind: 'ellipse', cx: 0.4, cy: 0.5, w: 0.2, h: 0.3, rot: 0, mode: 'add' }],
			strokes: [],
			invert: false,
			feather: 0
		}
	}
};
/** An older run: only the sort knobs, no title, branched from the ridge. */
const OLD: Run = { ...base(8), parent_run_id: 7, settings: { mode: 'edges', angle: 12, seed: 3 }, seed: 3 };

type Fake = {
	patches: { id: number; title: unknown }[];
	posts: Record<string, unknown>[];
	failPatch: (n: number) => void;
	runs: Run[];
};

async function gallery(page: Page, opts: { runs?: Run[]; bin?: Run[] } = {}): Promise<Fake> {
	const runs: Run[] = (opts.runs ?? [RIDGE, OLD]).map((r) => structuredClone(r));
	const bin: Run[] = (opts.bin ?? []).map((r) => structuredClone(r));
	const f: Fake = { patches: [], posts: [], failPatch: () => {}, runs };
	let fail = 0;
	f.failPatch = (n) => (fail = n);
	let nextId = 100;
	const png = makePng(1, 8);
	await page.route('**/api/features', (r) => r.fulfill({ json: { share: false, fetch: false } }));
	await page.route('**/api/usage', (r) =>
		r.fulfill({
			json: { used_bytes: 1000, budget_bytes: 50 * 2 ** 30, trash_bytes: 0, runs: runs.length, trash_runs: bin.length }
		})
	);
	await page.route('**/api/images/**', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
	// registered after the generic image route: the last route registered wins
	await page.route('**/api/images/check', (r) => r.fulfill({ json: { exists: true } }));
	await page.route('**/api/runs?**', (r) => {
		const trashed = new URL(r.request().url()).searchParams.get('trashed') === '1';
		return r.fulfill({ json: { runs: trashed ? bin : runs, next_cursor: null } });
	});
	await page.route('**/api/runs', async (r) => {
		if (r.request().method() !== 'POST') return r.fallback();
		const body = r.request().postDataBuffer()?.toString('latin1') ?? '';
		const meta = /name="meta"\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1];
		const m = meta ? (JSON.parse(meta) as Record<string, unknown>) : {};
		f.posts.push(m);
		const run = {
			...base(nextId++),
			settings: m.settings as Record<string, unknown>,
			parent_run_id: (m.parent_run_id as number | null) ?? null
		};
		runs.unshift(run);
		return r.fulfill({ status: 201, json: run });
	});
	await page.route(/\/api\/runs\/\d+$/, async (r) => {
		const id = Number(new URL(r.request().url()).pathname.split('/').pop());
		const run = [...runs, ...bin].find((x) => x.id === id);
		if (!run) return r.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'no' } } });
		if (r.request().method() === 'PATCH') {
			const body = r.request().postDataJSON() as { title?: string };
			f.patches.push({ id, title: body.title });
			if (fail > 0) {
				fail--;
				return r.fulfill({ status: 500, json: { error: { code: 'internal', message: 'boom' } } });
			}
			if ('title' in body) run.title = (body.title ?? '').trim().replace(/\s+/g, ' ') || null;
		}
		return r.fulfill({ json: run });
	});
	return f;
}

const card = (page: Page, i = 0) => page.getByTestId('run').nth(i);

test('rename in place: Enter saves, the name shows at once and the server got the tidy version', async ({ page }) => {
	const api = await gallery(page);
	await page.goto('/archive');
	await expect(card(page)).toBeVisible();
	await card(page).getByRole('button', { name: 'Rename Ridge study' }).click();
	const input = card(page).getByTestId('run-name-input');
	await expect(input).toBeFocused();
	await input.fill('  Birches   at dusk \u0007 ');
	await input.press('Enter');
	await expect(card(page).getByTestId('run-name')).toContainText('Birches at dusk');
	expect(api.patches).toEqual([{ id: 7, title: 'Birches at dusk' }]);
	await expect(card(page).getByTestId('run-name')).toBeFocused(); // keyboard focus is where it started
	await page.reload();
	await expect(card(page).getByTestId('run-name')).toContainText('Birches at dusk'); // it stuck
});

test('Escape cancels, and an untouched name sends nothing (an automatic name does not become a fixed title)', async ({
	page
}) => {
	const api = await gallery(page);
	await page.goto('/archive');
	await card(page).getByTestId('run-name').click();
	await card(page).getByTestId('run-name-input').fill('Nope');
	await card(page).getByTestId('run-name-input').press('Escape');
	await expect(card(page).getByTestId('run-name')).toContainText('Ridge study');
	await card(page, 1).getByTestId('run-name').click(); // the older run has only an automatic name
	await card(page, 1).getByTestId('run-name-input').press('Enter');
	expect(api.patches).toEqual([]);
});

test('clearing the name goes back to the automatic one', async ({ page }) => {
	const api = await gallery(page);
	await page.goto('/archive');
	await card(page).getByTestId('run-name').click();
	await card(page).getByTestId('run-name-input').fill('');
	await card(page).getByTestId('run-name-input').press('Enter');
	expect(api.patches).toEqual([{ id: 7, title: '' }]);
	await expect(card(page).getByTestId('run-name')).not.toContainText('Ridge study');
	await expect(card(page).getByTestId('run-name')).not.toHaveText('');
});

test('leaving the field saves it', async ({ page }) => {
	const api = await gallery(page);
	await page.goto('/archive');
	await card(page).getByTestId('run-name').click();
	await card(page).getByTestId('run-name-input').fill('By blur');
	await page.getByRole('searchbox', { name: 'Search' }).click();
	await expect(card(page).getByTestId('run-name')).toContainText('By blur');
	expect(api.patches).toEqual([{ id: 7, title: 'By blur' }]);
});

test('a failed rename puts the old name back, says so, and Retry stores it', async ({ page }) => {
	const api = await gallery(page);
	await page.goto('/archive');
	api.failPatch(1);
	await card(page).getByTestId('run-name').click();
	await card(page).getByTestId('run-name-input').fill('Will fail');
	await card(page).getByTestId('run-name-input').press('Enter');
	await expect(page.getByTestId('archive-error')).toContainText('Couldn’t save');
	await expect(card(page).getByTestId('run-name')).toContainText('Ridge study');
	await page.getByRole('button', { name: 'Retry now' }).click();
	await expect(card(page).getByTestId('run-name')).toContainText('Will fail');
	await expect(page.getByTestId('archive-error')).toHaveCount(0);
});

test('a card opens the viewer: the picture, the recipe in words, Esc closes and focus goes back', async ({ page }) => {
	await gallery(page);
	await page.goto('/archive');
	const opener = card(page).getByTestId('run-open');
	await opener.click();
	const viewer = page.getByTestId('viewer');
	await expect(viewer).toBeVisible();
	await expect(viewer.getByTestId('viewer-image')).toBeVisible();
	await expect(viewer).toContainText('Ridge study');
	const slate = page.getByTestId('viewer-slate');
	await expect(slate).toContainText('Intervals');
	await expect(slate).toContainText('wave');
	await expect(slate).toContainText('Direction');
	await expect(slate).toContainText('30°');
	await expect(slate).toContainText('Shapes');
	await expect(slate).toContainText('hexagon');
	await expect(slate).toContainText('Protected');
	await expect(slate).toContainText('1 shape');
	const results = await new AxeBuilder({ page }).analyze();
	expect(
		results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)
	).toEqual([]);
	await page.keyboard.press('Escape');
	await expect(viewer).toHaveCount(0);
	await expect(opener).toBeFocused();
});

test('the viewer renames too, and the card behind it follows', async ({ page }) => {
	await gallery(page);
	await page.goto('/archive');
	await card(page).getByTestId('run-open').click();
	await page.getByTestId('viewer').getByTestId('run-name').click();
	await page.getByTestId('viewer').getByTestId('run-name-input').fill('From the viewer');
	await page.getByTestId('viewer').getByTestId('run-name-input').press('Enter');
	await expect(page.getByTestId('viewer')).toContainText('From the viewer');
	await page.keyboard.press('Escape');
	await expect(card(page).getByTestId('run-name')).toContainText('From the viewer');
});

test('Open in Studio brings the whole look back, and saving makes a child of that run without touching it', async ({
	page
}) => {
	const api = await gallery(page);
	await page.goto('/archive');
	await card(page).getByTestId('run-open').click();
	await page.getByTestId('viewer-open').click();
	await expect(page).toHaveURL(/\/studio\?run=7/);
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await expect(page.getByTestId('name')).toHaveText('Ridge study');
	await expect(page.getByTestId('k-mode')).toHaveText('wave');
	await expect(page.getByTestId('k-angle')).toHaveText('30°');
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'saved'); // exactly what is stored: nothing to save yet
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('shape-hexagon')).toHaveClass(/on/); // the cells came back
	// nothing has been written yet
	expect(api.posts).toEqual([]);

	await page.keyboard.press('Escape');
	await page.getByTestId('k-angle').click();
	await page.getByTestId('angle-input').fill('77');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'unsaved');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page.getByTestId('save').click();
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'saved');
	expect(api.posts).toHaveLength(1);
	const meta = api.posts[0]!;
	expect(meta.parent_run_id).toBe(7);
	const settings = meta.settings as Record<string, unknown>;
	expect(settings.angle).toBe(77);
	expect(settings.regions).toMatchObject({ tiling: { shape: 'hexagon' } });
	expect(settings.mask).toMatchObject({ objects: [{ kind: 'ellipse' }] });
	expect(api.patches, 'the run that was opened is never edited').toEqual([]);
	const original = api.runs.find((r) => r.id === 7)!;
	expect(original.settings.angle, 'and its stored recipe is as it was').toBe(30);

	// the next change is a child of the one just saved: a line of versions
	await page.getByTestId('k-angle').click();
	await page.getByTestId('angle-input').fill('99');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await page.getByTestId('save').click();
	await expect(page.getByTestId('save')).toHaveAttribute('data-state', 'saved');
	expect(api.posts).toHaveLength(2);
	expect(api.posts[1]!.parent_run_id).toBe(100); // the id the fake gave the first child
});

test('an older run with only its knobs opens fine, with no cells and no protected areas', async ({ page }) => {
	await gallery(page);
	await page.goto('/studio?run=8');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
	await expect(page.getByTestId('k-mode')).toHaveText('edges');
	await expect(page.getByTestId('k-angle')).toHaveText('12°');
	await page.getByTestId('pro-toggle').click();
	await expect(page.getByTestId('shape-none')).toHaveClass(/on/);
});

test('a run in the Bin offers Restore, not Open in Studio', async ({ page }) => {
	await gallery(page, { runs: [], bin: [{ ...RIDGE, trashed_at: 1700000000 }] });
	await page.goto('/archive');
	await page.getByRole('tab', { name: 'trash' }).click();
	await card(page).getByTestId('run-open').click();
	await expect(page.getByTestId('viewer-bin-note')).toContainText('Restore it');
	await expect(page.getByTestId('viewer-restore')).toBeVisible();
	await expect(page.getByTestId('viewer-open')).toHaveCount(0);
});

test('a run from another engine version says so, in the viewer and again in Studio', async ({ page }) => {
	await gallery(page, { runs: [{ ...RIDGE, engine_version: '0' }] });
	await page.goto('/archive');
	await card(page).getByTestId('run-open').click();
	await expect(page.getByTestId('viewer-engine-note')).toContainText('version 0');
	await page.getByTestId('viewer-open').click();
	await expect(page.getByTestId('engine-note')).toContainText('version 0');
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
});

test('a run that is gone says so and still leaves a working Studio', async ({ page }) => {
	await gallery(page);
	await page.goto('/studio?run=999');
	await expect(page.getByRole('alertdialog')).toBeVisible();
	await page
		.getByRole('alertdialog')
		.getByRole('button', { name: /Keep what I have|Choose another/ })
		.first()
		.click();
	await expect(page.getByTestId('state')).toHaveText('done', { timeout: 30_000 });
});

test('on a phone the viewer fills the screen, actions are 44 px, and nothing scrolls sideways', async ({ browser }) => {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	await ctx.addInitScript(() => localStorage.setItem('pixelsort.toured', 'true'));
	const page = await ctx.newPage();
	await gallery(page);
	await page.goto('/archive');
	await card(page).getByTestId('run-open').tap();
	await expect(page.getByTestId('viewer')).toBeVisible();
	const v = (await page.getByTestId('viewer').boundingBox())!;
	expect(v.width).toBeGreaterThanOrEqual(388);
	for (const id of ['viewer-open', 'viewer-download', 'viewer-close']) {
		const b = (await page.getByTestId(id).boundingBox())!;
		expect(b.height, id).toBeGreaterThanOrEqual(43.5);
		expect(b.width, id).toBeGreaterThanOrEqual(43.5);
	}
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	await ctx.close();
});
