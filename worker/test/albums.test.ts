import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { sign } from '../src/auth';

const ID = 'abcdefghijklmnopqrstuvwxyz';
const SECRET = 'test-secret';

async function sha256(data: Uint8Array | string): Promise<string> {
	const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function call(
	method: string,
	path: string,
	body?: Uint8Array | string,
	opts: { type?: string; signed?: boolean; declaredSha?: string } = {}
): Promise<Response> {
	const bytes = body === undefined ? new Uint8Array() : typeof body === 'string' ? new TextEncoder().encode(body) : body;
	const sha = await sha256(bytes);
	const headers = new Headers();
	if (opts.type) headers.set('Content-Type', opts.type);
	if (opts.signed !== false) {
		const ts = String(Math.floor(Date.now() / 1000));
		const declared = opts.declaredSha ?? sha;
		headers.set('X-PS-Timestamp', ts);
		headers.set('X-PS-Content-SHA256', declared);
		headers.set('X-PS-Signature', await sign(SECRET, method, path, ts, declared));
	}
	return exports.default.fetch(new Request('https://x.test' + path, { method, headers, body: body === undefined ? undefined : bytes }));
}

const manifest = (n = 2, extra: object = {}) =>
	JSON.stringify({
		v: 1,
		created: 1700000000,
		expires: null,
		images: Array.from({ length: n }, () => ({ w: 10, h: 10, mime: 'image/png' })),
		...extra
	});
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

test('uploads a manifest and two images and reads them back', async () => {
	expect((await call('PUT', `/api/albums/${ID}/manifest.json`, manifest())).status).toBe(200);
	expect((await call('PUT', `/api/albums/${ID}/images/0`, png, { type: 'image/png' })).status).toBe(200);
	expect((await call('PUT', `/api/albums/${ID}/thumbs/1`, png, { type: 'image/png' })).status).toBe(200);
	const img = await env.ALBUMS.get(`albums/${ID}/images/0`);
	expect(new Uint8Array(await img!.arrayBuffer())).toEqual(png);
	expect(img!.httpMetadata?.contentType).toBe('image/png');
	expect(await env.ALBUMS.head(`albums/${ID}/thumbs/1`)).not.toBeNull();
	expect(await (await env.ALBUMS.get(`albums/${ID}/manifest.json`))!.json()).toMatchObject({ v: 1 });
});

test('unsigned is 401', async () => {
	expect((await call('PUT', `/api/albums/${ID}/images/0`, png, { type: 'image/png', signed: false })).status).toBe(401);
	expect((await call('DELETE', `/api/albums/${ID}`, undefined, { signed: false })).status).toBe(401);
});

test('bad album id, bad index', async () => {
	expect((await call('PUT', `/api/albums/NOPE/images/0`, png, { type: 'image/png' })).status).toBe(400);
	expect((await call('PUT', `/api/albums/${ID}/images/200`, png, { type: 'image/png' })).status).toBe(400);
	expect((await call('PUT', `/api/albums/${ID}/images/01`, png, { type: 'image/png' })).status).toBe(400);
});

test('wrong content type is 415', async () => {
	expect((await call('PUT', `/api/albums/${ID}/images/0`, png, { type: 'text/html' })).status).toBe(415);
});

test('animations and video are accepted types', async () => {
	for (const type of ['image/gif', 'image/apng', 'video/mp4', 'video/webm']) {
		expect((await call('PUT', `/api/albums/${ID}/images/0`, png, { type })).status).toBe(200);
	}
	const withVideo = JSON.stringify({ v: 1, created: 1, expires: null, images: [{ w: 4, h: 3, mime: 'video/mp4' }] });
	expect((await call('PUT', `/api/albums/${ID}/manifest.json`, withVideo)).status).toBe(200);
	const withAvif = JSON.stringify({ v: 1, created: 1, expires: null, images: [{ w: 4, h: 3, mime: 'image/avif' }] });
	expect((await call('PUT', `/api/albums/${ID}/manifest.json`, withAvif)).status).toBe(400);
});

test('31 MB is 413 and is not stored', async () => {
	const big = new Uint8Array(31 * 1024 * 1024);
	expect((await call('PUT', `/api/albums/${ID}/images/5`, big, { type: 'image/png' })).status).toBe(413);
	expect(await env.ALBUMS.head(`albums/${ID}/images/5`)).toBeNull();
});

test('a body that does not match its declared hash is 400 and not stored', async () => {
	const res = await call('PUT', `/api/albums/${ID}/images/7`, png, { type: 'image/png', declaredSha: await sha256('something else') });
	expect(res.status).toBe(400);
	expect(await env.ALBUMS.head(`albums/${ID}/images/7`)).toBeNull();
});

test('manifest rules: 201 images refused, text names kept as data, bad shapes refused', async () => {
	expect((await call('PUT', `/api/albums/${ID}/manifest.json`, manifest(201))).status).toBe(400);
	const withScript = JSON.stringify({ v: 1, created: 1, expires: null, images: [{ w: 1, h: 1, mime: 'image/png', name: '<script>x</script>' }] });
	expect((await call('PUT', `/api/albums/${ID}/manifest.json`, withScript)).status).toBe(200);
	expect(await (await env.ALBUMS.get(`albums/${ID}/manifest.json`))!.text()).toContain('<script>');
	const longName = JSON.stringify({ v: 1, created: 1, expires: null, images: [{ w: 1, h: 1, mime: 'image/png', name: 'x'.repeat(61) }] });
	expect((await call('PUT', `/api/albums/${ID}/manifest.json`, longName)).status).toBe(400);
	expect((await call('PUT', `/api/albums/${ID}/manifest.json`, 'not json')).status).toBe(400);
	expect((await call('PUT', `/api/albums/${ID}/manifest.json`, manifest(1, { v: 2 }))).status).toBe(400);
	expect((await call('PUT', `/api/albums/${ID}/manifest.json`, manifest(1, { title: 5 }))).status).toBe(400);
	expect((await call('PUT', `/api/albums/${ID}/manifest.json`, manifest(1, { pad: 'x'.repeat(300 * 1024) }))).status).toBe(413);
});

test('revoke deletes 1500 objects, and a second revoke is 204', async () => {
	const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbb';
	await env.ALBUMS.put(`albums/${other}/manifest.json`, '{}');
	for (let i = 0; i < 1500; i += 100) {
		await Promise.all(Array.from({ length: 100 }, (_, j) => env.ALBUMS.put(`albums/${ID}/thumbs/x${i + j}`, 'a')));
	}
	expect((await env.ALBUMS.list({ prefix: `albums/${ID}/`, limit: 1000 })).truncated).toBe(true);
	expect((await call('DELETE', `/api/albums/${ID}`)).status).toBe(204);
	expect((await env.ALBUMS.list({ prefix: `albums/${ID}/` })).objects).toHaveLength(0);
	expect(await env.ALBUMS.head(`albums/${other}/manifest.json`)).not.toBeNull();
	expect((await call('DELETE', `/api/albums/${ID}`)).status).toBe(204);
});
