import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { sweep } from '../src/scheduled';

const NOW = Date.now();
const secs = (offset: number) => Math.floor(NOW / 1000) + offset;

async function album(name: string, expires: number | null | 'bad') {
	const body = expires === 'bad' ? 'not json' : JSON.stringify({ v: 1, created: 1, expires, images: [] });
	await env.ALBUMS.put(`albums/${name}/manifest.json`, body);
	await env.ALBUMS.put(`albums/${name}/images/0`, 'x');
}
const exists = async (name: string) => (await env.ALBUMS.head(`albums/${name}/manifest.json`)) !== null;

test('expired is deleted; future, null and malformed are kept', async () => {
	await album('expiredaaaaaaaaaaaaaaaaaaa', secs(-5));
	await album('futureaaaaaaaaaaaaaaaaaaaa', secs(3600));
	await album('foreveraaaaaaaaaaaaaaaaaaa', null);
	await album('brokenaaaaaaaaaaaaaaaaaaaa', 'bad');
	const r = await sweep(env, NOW);
	expect(r.deleted).toBe(1);
	expect(await exists('expiredaaaaaaaaaaaaaaaaaaa')).toBe(false);
	expect((await env.ALBUMS.list({ prefix: 'albums/expiredaaaaaaaaaaaaaaaaaaa/' })).objects).toHaveLength(0);
	expect(await exists('futureaaaaaaaaaaaaaaaaaaaa')).toBe(true);
	expect(await exists('foreveraaaaaaaaaaaaaaaaaaa')).toBe(true);
	expect(await exists('brokenaaaaaaaaaaaaaaaaaaaa')).toBe(true);
});

test('an album with no manifest is deleted only once it is a day old', async () => {
	await env.ALBUMS.put('albums/halfdoneaaaaaaaaaaaaaaaaaa/images/0', 'x');
	expect((await sweep(env, NOW)).deleted).toBe(0);
	expect((await sweep(env, NOW + 25 * 3600 * 1000)).deleted).toBeGreaterThanOrEqual(1);
	expect(await env.ALBUMS.head('albums/halfdoneaaaaaaaaaaaaaaaaaa/images/0')).toBeNull();
});

test('250 expired albums need two runs, 200 at a time', async () => {
	for (let i = 0; i < 250; i += 50) {
		await Promise.all(Array.from({ length: 50 }, (_, j) => album(`bulk${(i + j).toString().padStart(3, '0')}aaaaaaaaaaaaaaaaaaa`.slice(0, 26), secs(-10))));
	}
	const first = await sweep(env, NOW);
	expect(first.checked).toBe(200);
	expect(first.deleted).toBeGreaterThan(0);
	const second = await sweep(env, NOW);
	const left = (await env.ALBUMS.list({ prefix: 'albums/bulk', delimiter: '/' })).delimitedPrefixes;
	expect(first.deleted + second.deleted).toBe(250);
	expect(left).toHaveLength(0);
});
