import { expect, test } from 'vitest';
import { constantTimeEqual, sign, verify, verifiedBody } from '../src/auth';
import vectors from './vectors.json';

const SECRET = 'test-secret';

function signed(v: (typeof vectors)[number], over: Partial<Record<string, string>> = {}): Request {
	const headers = new Headers({
		'X-PS-Timestamp': over.timestamp ?? v.timestamp,
		'X-PS-Content-SHA256': over.bodySha ?? v.bodySha,
		'X-PS-Signature': over.signature ?? v.signature
	});
	return new Request('https://x.test' + (over.path ?? v.path), { method: over.method ?? v.method, headers });
}
const flip = (s: string) => s.slice(0, -1) + (s.endsWith('0') ? '1' : '0');

for (const v of vectors) {
	test(`vector "${v.name}": signs to the recorded value`, async () => {
		expect(await sign(SECRET, v.method, v.path, v.timestamp, v.bodySha)).toBe(v.signature);
	});
	test(`vector "${v.name}": accepted`, async () => {
		expect(await verify(signed(v), SECRET, Number(v.timestamp))).toBe('ok');
	});
	test(`vector "${v.name}": any one-character change is rejected`, async () => {
		const now = Number(v.timestamp);
		expect(await verify(signed(v, { method: v.method === 'GET' ? 'PUT' : 'GET' }), SECRET, now)).toBe('bad-signature');
		expect(await verify(signed(v, { path: v.path + 'x' }), SECRET, now)).toBe('bad-signature');
		expect(await verify(signed(v, { timestamp: flip(v.timestamp) }), SECRET, now)).toBe('bad-signature');
		expect(await verify(signed(v, { bodySha: flip(v.bodySha) }), SECRET, now)).toBe('bad-signature');
		expect(await verify(signed(v, { signature: flip(v.signature) }), SECRET, now)).toBe('bad-signature');
	});
}

test('301 seconds old is stale, 299 is fine, in either direction', async () => {
	const v = vectors[0];
	const t = Number(v.timestamp);
	expect(await verify(signed(v), SECRET, t + 301)).toBe('stale');
	expect(await verify(signed(v), SECRET, t - 301)).toBe('stale');
	expect(await verify(signed(v), SECRET, t + 299)).toBe('ok');
});

test('a missing header is "missing"', async () => {
	const req = new Request('https://x.test/fetch', { headers: { 'X-PS-Timestamp': '1700000000' } });
	expect(await verify(req, SECRET, 1700000000)).toBe('missing');
});

test('another secret does not verify', async () => {
	expect(await verify(signed(vectors[0]), 'other-secret', Number(vectors[0].timestamp))).toBe('bad-signature');
});

test('constant-time compare: equal, different, and different lengths', () => {
	expect(constantTimeEqual('abcd', 'abcd')).toBe(true);
	expect(constantTimeEqual('abcd', 'abce')).toBe(false);
	expect(constantTimeEqual('abcd', 'abc')).toBe(false);
});

async function drain(s: ReadableStream<Uint8Array>): Promise<string> {
	return await new Response(s).text();
}

test('verifiedBody passes a matching body and errors on a different one', async () => {
	const v = vectors[0];
	const body = () => new Response(v.body).body!;
	expect(await drain(verifiedBody(body(), v.bodySha))).toBe('hello');
	await expect(drain(verifiedBody(body(), flip(v.bodySha)))).rejects.toThrow();
});
