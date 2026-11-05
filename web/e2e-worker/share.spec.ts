import { expect, test, type APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc = (b: Buffer) => {
	let c = 0xffffffff;
	for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type), data]);
	const sum = Buffer.alloc(4);
	sum.writeUInt32BE(crc(body));
	return Buffer.concat([len, body, sum]);
}
/** A small grayscale PNG whose pixels depend on `n`, so every image has its own hash. */
function makePng(n: number, size = 16): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 0; // grayscale
	const rows: number[] = [];
	for (let y = 0; y < size; y++) {
		rows.push(0);
		for (let x = 0; x < size; x++) rows.push((x * 7 + y * 13 + n * 31) & 255);
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(Buffer.from(rows))),
		chunk('IEND', Buffer.alloc(0))
	]);
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function makeRun(api: APIRequestContext, n: number): Promise<number> {
	const [orig, result, thumb] = [makePng(n * 10 + 1), makePng(n * 10 + 2), makePng(n * 10 + 3, 8)];
	const img = (b: Buffer, w: number) => ({ sha256: sha(b), mime: 'image/png', w, h: w });
	const res = await api.post('/api/runs', {
		multipart: {
			meta: JSON.stringify({
				settings: { mode: 'random', angle: 45 },
				seed: n,
				engine_version: '1',
				duration_ms: 5,
				title: `Run ${n}`,
				original: img(orig, 16),
				result: img(result, 16),
				thumb: img(thumb, 8)
			}),
			original: { name: 'original', mimeType: 'image/png', buffer: orig },
			result: { name: 'result', mimeType: 'image/png', buffer: result },
			thumb: { name: 'thumb', mimeType: 'image/png', buffer: thumb }
		}
	});
	expect(res.status(), await res.text()).toBe(201);
	return ((await res.json()) as { id: number }).id;
}

test('create a share, open it with no cookies, see the pictures, revoke it, see the gone page', async ({
	request,
	browser
}) => {
	const features = await (await request.get('/api/features')).json();
	expect(features).toEqual({ share: true, fetch: true });

	const ids = [await makeRun(request, 1), await makeRun(request, 2)];
	const created = await request.post('/api/shares', {
		data: { run_ids: ids, include_recipe: false, title: 'Two ridges' }
	});
	expect(created.status(), await created.text()).toBe(201);
	const { id, url } = (await created.json()) as { id: string; url: string };
	expect(url).toBe(`http://127.0.0.1:8787/a/${id}`);

	// a friend: a brand new browser context, no cookies, no app
	const friend = await browser.newContext();
	const page = await friend.newPage();
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico'))
			errors.push(m.text() + ' ' + m.location().url);
	});
	await page.goto(url);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Two ridges');
	await expect(page.locator('#strip button')).toHaveCount(2);
	await expect(page.locator('#img')).toHaveJSProperty('complete', true);
	await expect.poll(() => page.locator('#img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(16);
	await expect(page.locator('#recipeBox')).toHaveCount(0); // not shared, so not offered
	await page.locator('#strip button').nth(1).click();
	await expect(page.locator('#cap')).toContainText('2 of 2');
	await page.screenshot({ path: 'test-results/share-viewer.png' });
	expect(errors, errors.join('\n')).toEqual([]); // the strict CSP did not block anything

	// the download links work, and the files send CORS
	const file = await friend.request.get(`${url}/0`);
	expect(file.status()).toBe(200);
	expect(file.headers()['content-type']).toBe('image/png');
	expect(file.headers()['access-control-allow-origin']).toBe('*');
	expect(sha(await file.body())).toBe(sha(makePng(12)));

	// an unsigned write straight at the Worker is refused
	const forged = await friend.request.put(`http://127.0.0.1:8787/api/albums/${id}/images/9`, {
		data: 'x',
		headers: { 'Content-Type': 'image/png' }
	});
	expect(forged.status()).toBe(401);

	// revoke in the app
	const revoked = await request.delete(`/api/shares/${id}`);
	expect(revoked.status()).toBe(200);
	const gone = await friend.request.get(url);
	expect(gone.status()).toBe(404);
	expect(await gone.text()).toContain('This gallery is');
	expect((await friend.request.get(`${url}/manifest.json`)).status()).toBe(404);
	expect((await friend.request.get(`${url}/0`)).status()).toBe(404);
	await page.goto(url);
	await expect(page.getByText('gone.')).toBeVisible();
	await friend.close();
});

test('the recipe is offered only when it was shared, and cannot break the page', async ({ request, browser }) => {
	const id1 = await makeRun(request, 3);
	const created = await request.post('/api/shares', { data: { run_ids: [id1], include_recipe: true } });
	expect(created.status()).toBe(201);
	const { url, id } = (await created.json()) as { url: string; id: string };
	const friend = await browser.newContext();
	const page = await friend.newPage();
	await page.goto(url);
	await expect(page.locator('#recipeBox')).toBeVisible();
	await expect(page.locator('#recipe')).toContainText('random');
	await page.screenshot({ path: 'test-results/share-viewer-recipe.png' });
	await friend.close();
	await request.delete(`/api/shares/${id}`);
});

test('/api/fetch refuses a private address through the real Worker', async ({ request }) => {
	const res = await request.post('/api/fetch', { data: { url: 'http://127.0.0.1:8896/healthz' } });
	expect(res.status()).toBe(502);
	expect(((await res.json()) as { error: { code: string } }).error.code).toBe('link-blocked');
});
