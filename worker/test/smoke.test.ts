import { exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';

test('the root is 404', async () => {
	const res = await exports.default.fetch(new Request('https://x.test/'));
	expect(res.status).toBe(404);
});

test('an unsigned write is 401', async () => {
	const res = await exports.default.fetch(
		new Request('https://x.test/api/albums/abcdefghijklmnopqrstuvwxyz/images/0', { method: 'PUT', body: 'hello' })
	);
	expect(res.status).toBe(401);
});

test('an album that was never stored is 404', async () => {
	const res = await exports.default.fetch(new Request('https://x.test/a/abcdefghijklmnopqrstuvwxyz'));
	expect(res.status).toBe(404);
});
