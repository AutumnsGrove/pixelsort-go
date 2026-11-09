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
/** A third run, so range and drag selection have somewhere to go. */
const THIRD: Run = { ...base(9), title: 'Third look', settings: { mode: 'random', angle: 5, seed: 9 }, seed: 9 };
/** A run with a saved animation. */
const ANIMATED: Run = { ...base(10), title: 'Moving ridge', video: { ...img('d'), mime: 'image/gif' } };
const VIDEO_RUN: Run = { ...base(11), title: 'Moving clip', video: { ...img('e'), mime: 'video/mp4' } };

type Fake = {
	patches: { id: number; title: unknown }[];
	posts: Record<string, unknown>[];
	failPatch: (n: number) => void;
	runs: Run[];
	trash: { ids: number[]; confirm_starred: boolean }[];
	restore: number[][];
	delete: number[][];
	shares: Record<string, unknown>[];
	missing: number[];
};

async function gallery(
	page: Page,
	opts: {
		runs?: Run[];
		bin?: Run[];
		features?: { share: boolean; fetch: boolean };
		shareRows?: Record<string, unknown>[];
		missing?: number[];
	} = {}
): Promise<Fake> {
	const runs: Run[] = (opts.runs ?? [RIDGE, OLD]).map((r) => structuredClone(r));
	const bin: Run[] = (opts.bin ?? []).map((r) => structuredClone(r));
	const f: Fake = {
		patches: [],
		posts: [],
		failPatch: () => {},
		runs,
		trash: [],
		restore: [],
		delete: [],
		shares: [],
		missing: opts.missing ?? []
	};
	const shareRows = opts.shareRows ?? [];
	let fail = 0;
	f.failPatch = (n) => (fail = n);
	let nextId = 100;
	const png = makePng(1, 8);
	await page.route('**/api/features', (r) => r.fulfill({ json: opts.features ?? { share: false, fetch: false } }));
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
	await page.route('**/api/runs/trash', (r) => {
		const body = r.request().postDataJSON() as { ids: number[]; confirm_starred: boolean };
		f.trash.push(body);
		const trashed = body.ids.filter((id) => !f.missing.includes(id));
		for (const id of trashed) {
			const i = runs.findIndex((x) => x.id === id);
			if (i < 0) continue;
			const [run] = runs.splice(i, 1);
			if (!run) continue;
			run.trashed_at = 1700000000;
			bin.unshift(run);
		}
		return r.fulfill({ json: { trashed, missing: f.missing } });
	});
	await page.route('**/api/runs/restore', (r) => {
		const body = r.request().postDataJSON() as { ids: number[] };
		f.restore.push(body.ids);
		for (const id of body.ids) {
			const i = bin.findIndex((x) => x.id === id);
			if (i < 0) continue;
			const [run] = bin.splice(i, 1);
			if (!run) continue;
			run.trashed_at = null;
			runs.unshift(run);
		}
		return r.fulfill({ json: { restored: body.ids.length } });
	});
	await page.route('**/api/runs/delete', (r) => {
		const body = r.request().postDataJSON() as { ids: number[] };
		f.delete.push(body.ids);
		const deleted = body.ids.filter((id) => !f.missing.includes(id));
		for (const id of deleted) {
			const i = bin.findIndex((x) => x.id === id);
			if (i >= 0) bin.splice(i, 1);
		}
		return r.fulfill({ json: { deleted, missing: f.missing } });
	});
	await page.route('**/api/shares', (r) => {
		if (r.request().method() === 'POST') {
			f.shares.push(r.request().postDataJSON() as Record<string, unknown>);
			const id = 'abcdefghijklmnopqrstuvwxyz';
			return r.fulfill({ status: 201, json: { id, url: `https://share.example/a/${id}`, expires_at: null } });
		}
		return r.fulfill({ json: { shares: shareRows } });
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

test('a run with an animation shows a badge and plays the animation in the viewer', async ({ page }) => {
	await gallery(page, { runs: [ANIMATED] });
	await page.goto('/archive');
	await expect(card(page).getByTestId('run-animated')).toBeVisible();
	await card(page).getByTestId('run-open').click();
	const viewer = page.getByTestId('viewer');
	await expect(viewer.getByTestId('viewer-animation')).toBeVisible();
	await expect(viewer.getByTestId('viewer-anim-download')).toHaveAttribute('download', /-anim-\d+\.gif$/);
});

test('a video run plays in a video element', async ({ page }) => {
	await gallery(page, { runs: [VIDEO_RUN] });
	await page.goto('/archive');
	await card(page).getByTestId('run-open').click();
	const viewer = page.getByTestId('viewer');
	await expect(viewer.getByTestId('viewer-video')).toBeVisible();
	await expect(viewer.getByTestId('viewer-image')).toHaveCount(0);
	await expect(viewer.getByTestId('viewer-anim-download')).toHaveAttribute('download', /-anim-\d+\.mp4$/);
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

test('select several pictures with click, Shift-range, drag and Ctrl/Cmd-click; Escape clears', async ({ page }) => {
	await gallery(page, { runs: [RIDGE, OLD, THIRD] });
	await page.goto('/archive');
	await expect(page.getByTestId('run')).toHaveCount(3);
	await page.getByTestId('select-toggle').click();
	await expect(page.getByTestId('bulk-bar')).toHaveCount(0);

	await card(page, 0).getByTestId('run-open').click();
	await expect(page.getByTestId('bulk-count')).toHaveText('1 selected');
	await card(page, 2)
		.getByTestId('run-open')
		.click({ modifiers: ['Shift'] });
	await expect(page.getByTestId('bulk-count')).toHaveText('3 selected');
	await card(page, 1)
		.getByTestId('run-open')
		.click({ modifiers: ['ControlOrMeta'] });
	await expect(page.getByTestId('bulk-count')).toHaveText('2 selected');

	// drag from the first card to the third: the whole run of cards between them
	const first = (await card(page, 0).getByTestId('run-open').boundingBox())!;
	const third = (await card(page, 2).getByTestId('run-open').boundingBox())!;
	await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
	await page.mouse.down();
	await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2, { steps: 6 });
	await page.mouse.up();
	await expect(page.getByTestId('bulk-count')).toHaveText('3 selected');

	await page.keyboard.press('Escape');
	await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
	await expect(page.getByTestId('select-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('Cmd/Ctrl+A selects all shown pictures, and changing tab clears the selection', async ({ page }) => {
	await gallery(page, { runs: [RIDGE, OLD, THIRD] });
	await page.goto('/archive');
	await expect(page.getByTestId('run')).toHaveCount(3);
	await page.getByTestId('select-toggle').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
	await expect(page.getByTestId('bulk-count')).toHaveText('3 selected');
	await page.getByRole('tab', { name: 'starred' }).click();
	await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
	await expect(page.getByTestId('select-toggle')).toHaveCount(0); // no pictures in this tab
});

test('bulk share makes one new album link containing exactly the selected pictures', async ({ page }) => {
	const api = await gallery(page, {
		runs: [RIDGE, OLD, THIRD],
		features: { share: true, fetch: false }
	});
	await page.goto('/archive');
	await expect(page.getByTestId('run')).toHaveCount(3);
	await page.getByTestId('select-toggle').click();
	await page.getByRole('checkbox', { name: 'Select Ridge study' }).check();
	await card(page, 2)
		.getByTestId('run-open')
		.click({ modifiers: ['ControlOrMeta'] });
	await expect(page.getByTestId('bulk-count')).toHaveText('2 selected');
	await page.getByTestId('bulk-share').click();
	const dialog = page.getByTestId('share-dialog');
	await expect(dialog).toContainText('2 pictures');
	await dialog.getByRole('button', { name: 'Create link' }).click();
	await expect(page.getByTestId('share-url')).toHaveValue(/\/a\/abcdefghijklmnopqrstuvwxyz$/);
	expect(api.shares).toHaveLength(1);
	expect(api.shares[0]).toMatchObject({ run_ids: [7, 9], title: '2 pictures' });
});

test('bulk bin says the shared and starred warnings once, then moves only the selected pictures', async ({ page }) => {
	const api = await gallery(page, {
		runs: [{ ...RIDGE, starred: true }, OLD, THIRD],
		features: { share: true, fetch: false },
		shareRows: [{ id: 'a'.repeat(26), revoked_at: null, expires_at: null, run_ids: [7] }]
	});
	await page.goto('/archive');
	await expect(page.getByTestId('run')).toHaveCount(3);
	await page.getByTestId('select-toggle').click();
	await page.getByRole('checkbox', { name: 'Select Ridge study' }).check();
	await card(page, 1)
		.getByTestId('run-open')
		.click({ modifiers: ['ControlOrMeta'] });
	await page.getByTestId('bulk-trash').click();
	const dialog = page.getByTestId('bulk-confirm');
	await expect(dialog).toContainText('Move 2 pictures to the bin?');
	await expect(dialog).toContainText('1 picture is in a shared link');
	await expect(dialog).toContainText('1 picture is starred');
	const results = await new AxeBuilder({ page }).analyze();
	expect(
		results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)
	).toEqual([]);
	await dialog.getByTestId('bulk-confirm-yes').click();
	await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
	expect(api.trash).toEqual([{ ids: [7, 8], confirm_starred: true }]);
	await expect(page.getByTestId('run')).toHaveCount(1);
});

test('delete forever confirms the count and removes exactly the selected pictures from the bin', async ({ page }) => {
	const inBin = (r: Run): Run => ({ ...r, trashed_at: 1700000000 });
	const api = await gallery(page, { runs: [], bin: [inBin(RIDGE), inBin(OLD), inBin(THIRD)] });
	await page.goto('/archive');
	await page.getByRole('tab', { name: 'trash' }).click();
	await expect(page.getByTestId('run')).toHaveCount(3);
	await page.getByTestId('select-toggle').click();
	await page.getByRole('checkbox', { name: 'Select Ridge study' }).check();
	await card(page, 1)
		.getByTestId('run-open')
		.click({ modifiers: ['ControlOrMeta'] });
	await page.getByTestId('bulk-delete').click();
	const dialog = page.getByTestId('bulk-confirm');
	await expect(dialog).toContainText('Delete 2 pictures forever?');
	await expect(dialog).toContainText('This cannot be undone');
	await dialog.getByTestId('bulk-confirm-yes').click();
	expect(api.delete).toEqual([[7, 8]]);
	await expect(page.getByTestId('run')).toHaveCount(1);
});

test('bulk restore confirms once and puts exactly the selected pictures back', async ({ page }) => {
	const inBin = (r: Run): Run => ({ ...r, trashed_at: 1700000000 });
	const api = await gallery(page, { runs: [], bin: [inBin(RIDGE), inBin(OLD), inBin(THIRD)] });
	await page.goto('/archive');
	await page.getByRole('tab', { name: 'trash' }).click();
	await expect(page.getByTestId('run')).toHaveCount(3);
	await page.getByTestId('select-toggle').click();
	await page.getByRole('checkbox', { name: 'Select Ridge study' }).check();
	await card(page, 1)
		.getByTestId('run-open')
		.click({ modifiers: ['ControlOrMeta'] });
	await page.getByTestId('bulk-restore').click();
	const dialog = page.getByTestId('bulk-confirm');
	await expect(dialog).toContainText('Restore 2 pictures?');
	await dialog.getByTestId('bulk-confirm-yes').click();
	expect(api.restore).toEqual([[7, 8]]);
	await expect(page.getByTestId('run')).toHaveCount(1);
});

test('a partial trash keeps the failed pictures selected and names them', async ({ page }) => {
	const api = await gallery(page, { runs: [RIDGE, OLD, THIRD], missing: [9] });
	await page.goto('/archive');
	await expect(page.getByTestId('run')).toHaveCount(3);
	await page.getByTestId('select-toggle').click();
	await page.getByTestId('select-all').click();
	await expect(page.getByTestId('bulk-count')).toHaveText('3 selected');
	await page.getByTestId('bulk-trash').click();
	await page.getByTestId('bulk-confirm-yes').click();
	await expect(page.getByTestId('bulk-notice')).toContainText('1 of 3 could not be changed: Third look.');
	await expect(page.getByTestId('bulk-notice')).toContainText('It is still selected');
	await expect(page.getByTestId('bulk-count')).toHaveText('1 selected');
	expect(api.trash).toEqual([{ ids: [7, 8, 9], confirm_starred: true }]);
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
