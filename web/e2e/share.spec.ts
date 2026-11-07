import { expect, test, type Page } from '@playwright/test';
import { makePng } from './png';

const sha = (c: string) => c.repeat(64);
const img = (c: string) => ({ sha256: sha(c), mime: 'image/png', w: 8, h: 8, bytes: 100 });
const run = {
	id: 1,
	created_at: Math.floor(Date.now() / 1000) - 60,
	original: { ...img('a'), mime: 'image/jpeg' },
	result: img('b'),
	thumb: img('c'),
	settings: { mode: 'random', angle: 45 },
	seed: 3,
	engine_version: '1',
	duration_ms: 10,
	parent_run_id: null,
	starred: false,
	title: 'Sunset ridge',
	notes: null,
	trashed_at: null,
	tags: []
};

/** A JPEG made in the page, with an Exif segment (carrying a fake GPS string) spliced in after the start marker. */
async function jpegWithExif(page: Page): Promise<Buffer> {
	const bytes = await page.evaluate(async () => {
		const c = document.createElement('canvas');
		c.width = c.height = 8;
		c.getContext('2d')!.fillRect(0, 0, 8, 8);
		const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg'));
		return Array.from(new Uint8Array(await blob.arrayBuffer()));
	});
	const exif = Buffer.from('Exif\0\0GPSLatitude=59.33;Make=SecretCam');
	const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
	const jpg = Buffer.from(bytes);
	const out = Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]);
	expect(out.toString('latin1')).toContain('Exif'); // the fixture really carries metadata
	return out;
}

type Mock = { shares: object[]; posted: Buffer[]; revoked: string[] };
async function mockServer(page: Page, opts: { features?: { share: boolean; fetch: boolean } } = {}): Promise<Mock> {
	const m: Mock = { shares: [], posted: [], revoked: [] };
	const jpeg = await jpegWithExif(page);
	const png = makePng(1, 8);
	await page.route('**/api/features', (r) => r.fulfill({ json: opts.features ?? { share: true, fetch: true } }));
	await page.route('**/api/runs?**', (r) => r.fulfill({ json: { runs: [run], next_cursor: null } }));
	await page.route('**/api/usage', (r) =>
		r.fulfill({ json: { used_bytes: 1000, budget_bytes: 50 * 2 ** 30, trash_bytes: 0, runs: 1, trash_runs: 0 } })
	);
	await page.route('**/api/images/**', (r) =>
		r.fulfill({
			body: r.request().url().includes(sha('a')) ? jpeg : png,
			contentType: r.request().url().includes(sha('a')) ? 'image/jpeg' : 'image/png'
		})
	);
	await page.route('**/api/shares', (r) => {
		if (r.request().method() === 'POST') {
			m.posted.push(r.request().postDataBuffer() ?? Buffer.alloc(0));
			const id = 'abcdefghijklmnopqrstuvwxyz';
			m.shares = [
				{
					id,
					url: `https://share.example/a/${id}`,
					created_at: 1700000000,
					expires_at: null,
					revoked_at: null,
					title: 'Sunset ridge',
					include_recipe: false,
					include_original: true,
					items: 1,
					run_ids: [1]
				}
			];
			return r.fulfill({ status: 201, json: { id, url: `https://share.example/a/${id}`, expires_at: null } });
		}
		return r.fulfill({ json: { shares: m.shares } });
	});
	await page.route('**/api/shares/*', (r) => {
		m.revoked.push(r.request().url().split('/').pop()!);
		m.shares = m.shares.map((s) => ({ ...s, revoked_at: 1700000100 }));
		return r.fulfill({ json: { ok: true } });
	});
	return m;
}

test('share a picture with its original: the original goes up without metadata, then revoke it from Albums', async ({
	page
}) => {
	await page.goto('/archive'); // any page of the app, so the canvas helper has a document
	const m = await mockServer(page);
	await page.goto('/archive');
	await page.getByRole('button', { name: 'Share Sunset ridge' }).click({ force: true });
	const dialog = page.getByTestId('share-dialog');
	await expect(dialog).toContainText('Anyone with the link can see this');
	await expect(dialog.getByLabel('The recipe (the settings)')).not.toBeChecked();
	await dialog.getByLabel(/The original too/).check();
	await page.screenshot({ path: 'test-results/share-dialog.png' });
	await dialog.getByRole('button', { name: 'Create link' }).click();
	await expect(page.getByTestId('share-url')).toHaveValue(/\/a\/abcdefghijklmnopqrstuvwxyz$/);

	expect(m.posted).toHaveLength(1);
	const body = m.posted[0]!.toString('latin1');
	expect(body).toContain('name="orig-1"');
	expect(body).toContain('"include_original":true');
	expect(body).not.toContain('Exif');
	expect(body).not.toContain('GPSLatitude');
	expect(body).not.toContain('SecretCam');

	await page.getByRole('button', { name: 'Done' }).click();
	await page.getByRole('tab', { name: 'albums' }).click();
	const row = page.getByTestId('share-row');
	await expect(row).toContainText('Sunset ridge');
	await expect(row).toContainText('1 picture');
	await page.screenshot({ path: 'test-results/share-albums.png' });
	await row.getByRole('button', { name: 'Revoke' }).click();
	await page.getByTestId('revoke-yes').click();
	await expect(row).toContainText('Revoked');
	expect(m.revoked).toEqual(['abcdefghijklmnopqrstuvwxyz']);
});

test('without the Worker there is no Share button and no Albums tab', async ({ page }) => {
	await mockServer(page, { features: { share: false, fetch: false } });
	await page.goto('/archive');
	await expect(page.getByTestId('run')).toHaveCount(1);
	await expect(page.getByRole('button', { name: /^Share / })).toHaveCount(0);
	await expect(page.getByRole('tab', { name: 'albums' })).toHaveCount(0);
});

test('a failed share says what is safe and offers to try again', async ({ page }) => {
	await mockServer(page);
	await page.route('**/api/shares', (r) =>
		r.request().method() === 'POST'
			? r.fulfill({ status: 502, json: { error: { code: 'upstream_failed', message: 'x' } } })
			: r.fulfill({ json: { shares: [] } })
	);
	await page.goto('/archive');
	await page.getByRole('button', { name: 'Share Sunset ridge' }).click({ force: true });
	await page.getByRole('button', { name: 'Create link' }).click();
	await expect(page.getByTestId('share-error')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Create link' })).toBeEnabled();
});

test('binning a picture that is in a shared link warns first', async ({ page }) => {
	const m = await mockServer(page);
	m.shares = [
		{
			id: 'a'.repeat(26),
			url: `https://share.example/a/${'a'.repeat(26)}`,
			created_at: 1700000000,
			expires_at: null,
			revoked_at: null,
			title: 'Sunset ridge',
			include_recipe: false,
			include_original: false,
			items: 1,
			run_ids: [1]
		}
	];
	let trashed = 0;
	await page.route('**/api/runs/trash', (r) => {
		trashed++;
		return r.fulfill({ json: { trashed: [1], missing: [] } });
	});
	await page.goto('/archive');
	await page.getByRole('button', { name: 'Move Sunset ridge to the bin' }).click({ force: true });
	const dialog = page.getByTestId('bulk-confirm');
	await expect(dialog).toContainText('The shared copy stays up until you revoke it');
	expect(trashed).toBe(0);
	await dialog.getByTestId('bulk-confirm-cancel').click();
	await expect(dialog).toHaveCount(0);
	await page.getByRole('button', { name: 'Move Sunset ridge to the bin' }).click({ force: true });
	await page.getByTestId('bulk-confirm-yes').click();
	await expect.poll(() => trashed).toBe(1);
});
