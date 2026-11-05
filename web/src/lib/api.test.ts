import { expect, test } from 'vitest';
import { ApiError, ServerBackend } from './api';

type Call = { url: string; init?: RequestInit };
function fake(responses: (Response | ((c: Call) => Response))[]) {
	const calls: Call[] = [];
	const f = (async (url: string, init?: RequestInit) => {
		const c = { url, init };
		calls.push(c);
		const r = responses.shift();
		return typeof r === 'function' ? r(c) : (r ?? new Response('{}'));
	}) as unknown as typeof fetch;
	return { calls, backend: new ServerBackend(f) };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

test('cursor paging concatenates every page', async () => {
	const { backend, calls } = fake([
		json({ runs: [{ id: 1 }], next_cursor: 'abc' }),
		json({ runs: [{ id: 2 }], next_cursor: null })
	]);
	const all = await backend.allRuns();
	expect(all.map((r) => r.id)).toEqual([1, 2]);
	expect(calls[1]!.url).toContain('cursor=abc');
});

test('saveRun skips the original upload when the server already has it', async () => {
	const png = (n: number) => new Blob([new Uint8Array([137, 80, 78, 71, n])], { type: 'image/png' });
	const { backend, calls } = fake([json({ exists: true }), json({ id: 7 }, 201)]);
	await backend.saveRun({
		settings: {},
		seed: 1,
		engineVersion: '1',
		durationMs: 5,
		original: png(1),
		result: png(2),
		thumb: png(3),
		w: 4,
		h: 4
	});
	const form = calls[1]!.init!.body as FormData;
	expect(form.has('original')).toBe(false);
	expect(form.has('result') && form.has('thumb') && form.has('meta')).toBe(true);
	const meta = JSON.parse(form.get('meta') as string);
	expect(meta.original.sha256).toMatch(/^[0-9a-f]{64}$/);
});

test('saveRun uploads the original when it is new', async () => {
	const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
	const { backend, calls } = fake([json({ exists: false }), json({ id: 7 }, 201)]);
	await backend.saveRun({
		settings: {},
		seed: 1,
		engineVersion: '1',
		durationMs: 5,
		original: png,
		result: png,
		thumb: png,
		w: 1,
		h: 1
	});
	expect((calls[1]!.init!.body as FormData).has('original')).toBe(true);
});

test('error responses become ApiError with the server code', async () => {
	const { backend } = fake([json({ error: { code: 'too_large', message: 'big' } }, 413)]);
	await expect(backend.usage()).rejects.toMatchObject({ status: 413, code: 'too_large' });
	await expect(fake([json({ error: { code: 'x', message: 'm' } }, 500)]).backend.usage()).rejects.toBeInstanceOf(
		ApiError
	);
});

test('204 answers resolve to undefined', async () => {
	const { backend } = fake([new Response(null, { status: 200 })]);
	expect(backend.imageUrl('a'.repeat(64))).toBe(`/api/images/${'a'.repeat(64)}`);
});
