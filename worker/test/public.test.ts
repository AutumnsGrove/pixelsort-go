import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import worker from '../src/index';
import { expect, test } from 'vitest';

const ID = 'cccccccccccccccccccccccccc';
const png = new Uint8Array([137, 80, 78, 71, 10, 11, 12, 13, 14, 15]);

async function seed(manifest: object, id = ID) {
	await env.ALBUMS.put(`albums/${id}/manifest.json`, JSON.stringify(manifest));
	await env.ALBUMS.put(`albums/${id}/images/0`, png, { httpMetadata: { contentType: 'image/png' } });
	await env.ALBUMS.put(`albums/${id}/thumbs/0`, png, { httpMetadata: { contentType: 'image/png' } });
}
const base = (over: object = {}) => ({
	v: 1,
	created: 1,
	expires: null,
	title: 'Sunsets',
	images: [{ w: 4, h: 3, mime: 'image/png', name: 'one' }],
	...over
});
const get = (path: string, headers: Record<string, string> = {}) =>
	exports.default.fetch(new Request('https://x.test' + path, { headers }));

test('the viewer escapes names and titles', async () => {
	await seed(base({ title: '<img src=x onerror=alert(1)>', images: [{ w: 1, h: 1, mime: 'image/png', name: '<b>x</b>' }] }));
	const html = await (await get(`/a/${ID}`)).text();
	expect(html).not.toContain('<img src=x onerror=alert(1)>');
	expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
	expect(html).not.toContain('<b>x</b>');
});

test('a recipe cannot close the JSON block', async () => {
	await seed(base({ images: [{ w: 1, h: 1, mime: 'image/png', recipe: { note: '</script><script>alert(1)' } }] }));
	const html = await (await get(`/a/${ID}`)).text();
	expect(html).not.toContain('</script><script>alert(1)');
	expect(html).toContain('\\u003c/script>');
	expect(html).toContain('id="recipeBox"');
});

test('no recipe button unless a recipe is shared', async () => {
	await seed(base());
	expect(await (await get(`/a/${ID}`)).text()).not.toContain('id="recipeBox"');
});

test('every page has nosniff and a CSP whose nonce changes', async () => {
	await seed(base());
	const a = await get(`/a/${ID}`);
	const b = await get(`/a/${ID}`);
	const nonce = (r: Response) => /nonce-([A-Za-z0-9]+)/.exec(r.headers.get('Content-Security-Policy')!)![1];
	expect(a.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect(a.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
	expect(nonce(a)).not.toBe(nonce(b));
	expect(await a.text()).toContain(`<script nonce="${nonce(a)}">`);
});

test('files carry CORS and a content type; the manifest is not cached', async () => {
	await seed(base());
	const img = await get(`/a/${ID}/0`);
	expect(img.status).toBe(200);
	expect(img.headers.get('Access-Control-Allow-Origin')).toBe('*');
	expect(img.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
	expect(img.headers.get('Content-Type')).toBe('image/png');
	expect(img.headers.get('Cache-Control')).toBe('public, max-age=3600');
	expect(img.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect(new Uint8Array(await img.arrayBuffer())).toEqual(png);
	expect((await get(`/a/${ID}/0/thumb`)).status).toBe(200);
	const m = await get(`/a/${ID}/manifest.json`);
	expect(m.headers.get('Cache-Control')).toBe('no-cache');
	expect(m.headers.get('Access-Control-Allow-Origin')).toBe('*');
});

test('ranges work', async () => {
	await seed(base());
	const res = await get(`/a/${ID}/0`, { Range: 'bytes=2-5' });
	expect(res.status).toBe(206);
	expect(res.headers.get('Content-Range')).toBe(`bytes 2-5/${png.length}`);
	expect(new Uint8Array(await res.arrayBuffer())).toEqual(png.slice(2, 6));
});

test('missing, revoked and bad ids give the same gone page', async () => {
	await seed(base());
	await env.ALBUMS.delete(`albums/${ID}/manifest.json`);
	const revoked = await get(`/a/${ID}`);
	const never = await get('/a/dddddddddddddddddddddddddd');
	const bad = await get('/a/not-an-id');
	expect([revoked.status, never.status, bad.status]).toEqual([404, 404, 404]);
	const text = await revoked.text();
	expect(await never.text()).toBe(text);
	expect(await bad.text()).toBe(text);
	expect((await get(`/a/${ID}/0`)).status).toBe(404);
});

test('an expired album is gone, identical to a missing one, and its objects are deleted', async () => {
	const id = 'eeeeeeeeeeeeeeeeeeeeeeeeee';
	await seed(base({ expires: Math.floor(Date.now() / 1000) - 10 }), id);
	const ctx = createExecutionContext();
	const res = await worker.fetch(new Request(`https://x.test/a/${id}`), env as never, ctx);
	await waitOnExecutionContext(ctx);
	expect(res.status).toBe(404);
	expect(await res.text()).toBe(await (await get('/a/dddddddddddddddddddddddddd')).text());
	expect((await env.ALBUMS.list({ prefix: `albums/${id}/` })).objects).toHaveLength(0);
});

test('an expiry note shows when expires is set', async () => {
	const id = 'ffffffffffffffffffffffffff';
	await seed(base({ expires: Math.floor(Date.now() / 1000) + 3 * 86400 }), id);
	expect(await (await get(`/a/${id}`)).text()).toContain('expires in <b>3 days</b>');
});
