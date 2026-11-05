import { afterEach, expect, test, vi } from 'vitest';
import { checkUrl, handleFetch, sniff } from '../src/fetch';

afterEach(() => vi.restoreAllMocks());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
const HTML = new TextEncoder().encode('<!doctype html><html>not an image at all</html>');

const call = (url: string, env: { MAX_FETCH_BYTES?: string } = {}) =>
	handleFetch(new Request('https://w.test/fetch?url=' + encodeURIComponent(url)), env);
const img = (body: BodyInit, type = 'image/png', status = 200, extra: Record<string, string> = {}) =>
	new Response(body, { status, headers: { 'Content-Type': type, ...extra } });
const stub = (...rs: (Response | (() => Response | Promise<Response>))[]) => {
	const spy = vi.spyOn(globalThis, 'fetch');
	for (const r of rs) spy.mockImplementationOnce((async () => (typeof r === 'function' ? r() : r)) as never);
	return spy;
};
const errorCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

for (const bad of [
	'file:///etc/passwd',
	'ftp://example.com/a.png',
	'https://user:pw@example.com/a.png',
	'https://example.com:8080/a.png',
	'http://127.0.0.1/a.png',
	'http://[::1]/a.png',
	'http://10.0.0.1/a.png',
	'http://192.168.1.5/a.png',
	'http://169.254.169.254/latest',
	'http://localhost/a.png',
	'http://[::ffff:127.0.0.1]/a.png',
	'not a url'
]) {
	test(`guard refuses ${bad}`, async () => {
		const spy = stub();
		const res = await call(bad);
		expect(res.status).toBe(502);
		expect(await errorCode(res)).toBe('link-blocked');
		expect(spy).not.toHaveBeenCalled();
	});
}

test('public hosts on port 80 and 443 pass the guard', () => {
	expect(() => checkUrl('http://example.com/a.png')).not.toThrow();
	expect(() => checkUrl('https://example.com:443/a.png')).not.toThrow();
});

test('a valid PNG round-trips with the sniffed type, the final url and no-store', async () => {
	const spy = stub(img(PNG));
	const res = await call('https://example.com/a.png');
	expect(res.status).toBe(200);
	expect(res.headers.get('Content-Type')).toBe('image/png');
	expect(res.headers.get('X-Source-URL')).toBe('https://example.com/a.png');
	expect(res.headers.get('Cache-Control')).toBe('no-store');
	expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
	const init = spy.mock.calls[0][1] as RequestInit;
	const h = new Headers(init.headers);
	expect(h.get('User-Agent')).toBe('pixelsort-go/1');
	expect(h.get('Cookie')).toBeNull();
	expect(h.get('Authorization')).toBeNull();
	expect(init.redirect).toBe('manual');
});

test('a redirect to a private address is blocked at the second hop', async () => {
	const spy = stub(new Response(null, { status: 302, headers: { Location: 'http://10.0.0.5/secret.png' } }));
	const res = await call('https://example.com/a.png');
	expect(await errorCode(res)).toBe('link-blocked');
	expect(spy).toHaveBeenCalledTimes(1);
});

test('a redirect is followed when it stays public', async () => {
	stub(new Response(null, { status: 301, headers: { Location: '/b.png' } }), img(PNG));
	const res = await call('https://example.com/a.png');
	expect(res.status).toBe(200);
	expect(res.headers.get('X-Source-URL')).toBe('https://example.com/b.png');
});

test('six redirects fail', async () => {
	const hop = () => new Response(null, { status: 302, headers: { Location: 'https://example.com/next' } });
	stub(hop, hop, hop, hop, hop, hop);
	expect(await errorCode(await call('https://example.com/a.png'))).toBe('link-blocked');
});

test('blocked statuses are link-blocked', async () => {
	for (const status of [401, 403, 451, 404]) {
		stub(new Response('no', { status }));
		const res = await call('https://example.com/a.png');
		expect([res.status, await errorCode(res)]).toEqual([502, 'link-blocked']);
	}
});

test('connection refused is link-blocked', async () => {
	vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('connection refused'));
	expect(await errorCode(await call('https://example.com/a.png'))).toBe('link-blocked');
});

test('image header with HTML bytes is not an image', async () => {
	stub(img(HTML, 'image/png'));
	const res = await call('https://example.com/a.png');
	expect([res.status, await errorCode(res)]).toEqual([415, 'link-not-image']);
});

test('html header with PNG bytes is also rejected', async () => {
	stub(img(PNG, 'text/html'));
	const res = await call('https://example.com/a.png');
	expect([res.status, await errorCode(res)]).toEqual([415, 'link-not-image']);
});

test('a stream past the cap aborts without being read to the end', async () => {
	let cancelled = false;
	let sent = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(c) {
			const chunk = new Uint8Array(64 * 1024);
			chunk.set(PNG.slice(0, 4));
			sent += chunk.length;
			c.enqueue(chunk);
			if (sent > 100 * 1024 * 1024) c.close();
		},
		cancel() {
			cancelled = true;
		}
	});
	stub(img(body));
	const res = await call('https://example.com/big.png', { MAX_FETCH_BYTES: String(1024 * 1024) });
	await expect(res.arrayBuffer()).rejects.toBeDefined();
	expect(cancelled).toBe(true);
	expect(sent).toBeLessThan(10 * 1024 * 1024);
});

test('a declared size over the cap is link-too-large (413) before reading', async () => {
	stub(img(PNG, 'image/png', 200, { 'Content-Length': String(60 * 1024 * 1024) }));
	const res = await call('https://example.com/a.png');
	expect([res.status, await errorCode(res)]).toEqual([413, 'link-too-large']);
});

test('a slow site is link-timeout (504)', async () => {
	vi.useFakeTimers();
	vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
		((_u: unknown, init: RequestInit) =>
			new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as never
	);
	const pending = call('https://example.com/slow.png');
	await vi.advanceTimersByTimeAsync(15_001);
	const res = await pending;
	vi.useRealTimers();
	expect([res.status, await errorCode(res)]).toEqual([504, 'link-timeout']);
});

test('sniff recognises each format and nothing else', () => {
	const riff = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
	const avif = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
	expect(sniff(PNG)).toBe('image/png');
	expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
	expect(sniff(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
	expect(sniff(riff)).toBe('image/webp');
	expect(sniff(avif)).toBe('image/avif');
	expect(sniff(HTML)).toBeNull();
});
