import { describe, expect, test } from 'vitest';
import { EngineDownloadFailed, fetchEngine, type LoadProgress } from './loader';

const bytes = (n: number) => new Uint8Array(n).map((_, i) => i % 251);

/** A body that arrives in `chunks` pieces, optionally stalling forever after `stallAfter` of them. */
function streamed(
	data: Uint8Array,
	chunks: number,
	headers: Record<string, string> = {},
	stallAfter = Infinity
): Response {
	const size = Math.ceil(data.length / chunks);
	let sent = 0;
	let pulls = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(c) {
			if (pulls++ >= stallAfter) return new Promise(() => {}); // never answers: a dead connection
			if (sent >= data.length) return c.close();
			c.enqueue(data.slice(sent, sent + size));
			sent += size;
		}
	});
	return new Response(body, { status: 200, headers });
}

const fast = { stallMs: 40, retryDelayMs: 1 };

describe('fetchEngine', () => {
	test('returns the bytes and reports progress against the decoded size when the server sends one', async () => {
		const data = bytes(1000);
		const seen: LoadProgress[] = [];
		const got = await fetchEngine('/engine.wasm', {
			...fast,
			fetchFn: async () => streamed(data, 4, { 'Content-Length': '300', 'X-Uncompressed-Length': '1000' }),
			onProgress: (p) => seen.push(p)
		});
		expect(new Uint8Array(got)).toEqual(data);
		expect(seen.at(-1)).toEqual({ loaded: 1000, total: 1000, attempt: 1 });
		expect(seen.every((p) => p.total === 1000)).toBe(true);
		expect(seen.map((p) => p.loaded)).toEqual([...seen.map((p) => p.loaded)].sort((a, b) => a - b));
	});

	test('falls back to Content-Length, and to an unknown total', async () => {
		const data = bytes(600);
		const a: LoadProgress[] = [];
		await fetchEngine('/e', {
			...fast,
			fetchFn: async () => streamed(data, 3, { 'Content-Length': '600' }),
			onProgress: (p) => a.push(p)
		});
		expect(a.at(-1)?.total).toBe(600);
		const b: LoadProgress[] = [];
		await fetchEngine('/e', { ...fast, fetchFn: async () => streamed(data, 3), onProgress: (p) => b.push(p) });
		expect(b.at(-1)?.total).toBeNull();
	});

	test('retries once after a network error and then succeeds', async () => {
		const data = bytes(500);
		let calls = 0;
		const attempts: number[] = [];
		const got = await fetchEngine('/e', {
			...fast,
			fetchFn: async () => {
				calls++;
				if (calls === 1) throw new TypeError('Failed to fetch');
				return streamed(data, 2);
			},
			onProgress: (p) => attempts.push(p.attempt)
		});
		expect(calls).toBe(2);
		expect(new Uint8Array(got)).toEqual(data);
		expect(attempts.at(-1)).toBe(2);
	});

	test('retries after an HTTP error status', async () => {
		let calls = 0;
		const got = await fetchEngine('/e', {
			...fast,
			fetchFn: async () => (++calls === 1 ? new Response('nope', { status: 503 }) : streamed(bytes(300), 1))
		});
		expect(calls).toBe(2);
		expect(got.byteLength).toBe(300);
	});

	test('a connection that goes quiet is abandoned and retried', async () => {
		const data = bytes(800);
		let calls = 0;
		const got = await fetchEngine('/e', {
			...fast,
			fetchFn: async () => (++calls === 1 ? streamed(data, 8, {}, 2) : streamed(data, 8))
		});
		expect(calls).toBe(2);
		expect(new Uint8Array(got)).toEqual(data);
	});

	test('gives up after the retry and says how it failed', async () => {
		let calls = 0;
		const err = await fetchEngine('/engine.wasm', {
			...fast,
			fetchFn: async () => {
				calls++;
				return new Response('down', { status: 502 });
			}
		}).catch((e: unknown) => e);
		expect(calls).toBe(2);
		expect(err).toBeInstanceOf(EngineDownloadFailed);
		const e = err as EngineDownloadFailed;
		expect(e.name).toBe('EngineDownloadFailed');
		expect(e.attempts).toBe(2);
		expect(e.reason).toBe('http 502');
		expect(e.message).toContain('/engine.wasm');
	});

	test('a stall on every attempt reports a timeout', async () => {
		const err = (await fetchEngine('/e', { ...fast, fetchFn: async () => streamed(bytes(400), 4, {}, 1) }).catch(
			(e: unknown) => e
		)) as EngineDownloadFailed;
		expect(err).toBeInstanceOf(EngineDownloadFailed);
		expect(err.reason).toBe('timeout');
	});

	test('retries: 0 means a single attempt', async () => {
		let calls = 0;
		await fetchEngine('/e', {
			...fast,
			retries: 0,
			fetchFn: async () => (calls++, Promise.reject(new TypeError('x')))
		}).catch(() => {});
		expect(calls).toBe(1);
	});

	test('cancelling stops the download and does not retry', async () => {
		const ctl = new AbortController();
		let calls = 0;
		const p = fetchEngine('/e', {
			...fast,
			stallMs: 5000,
			signal: ctl.signal,
			fetchFn: async () => (calls++, streamed(bytes(400), 4, {}, 1))
		});
		setTimeout(() => ctl.abort(), 20);
		await expect(p).rejects.toThrow();
		expect(calls).toBe(1);
	});
});
