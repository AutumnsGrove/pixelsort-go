import { expect, test } from 'vitest';
import { ApiError } from './api';
import {
	buildCreateRequest,
	expiryDays,
	hasMetadata,
	linkCode,
	loadFromUrl,
	sharedRunIDs,
	LinkError,
	ShareBackend,
	type Features,
	type ShareRow
} from './share';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: 'image/png' });

function backend(responses: (Response | (() => Response))[]) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const f = (async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		const r = responses.shift();
		return typeof r === 'function' ? r() : (r ?? new Response('{}'));
	}) as unknown as typeof fetch;
	return { calls, b: new ShareBackend(f) };
}

test('the create request for each option combination', async () => {
	const base = { runIds: [3, 4], includeRecipe: false, includeOriginal: false, expiresInDays: null };
	const plain = buildCreateRequest(base);
	expect(JSON.parse(plain.body as string)).toEqual({
		run_ids: [3, 4],
		include_recipe: false,
		include_original: false,
		expires_in_days: null,
		title: ''
	});
	expect((plain.headers as Record<string, string>)['Content-Type']).toBe('application/json');

	const withRecipe = buildCreateRequest({ ...base, includeRecipe: true, expiresInDays: 30, title: 'Mara' });
	expect(JSON.parse(withRecipe.body as string)).toMatchObject({
		include_recipe: true,
		expires_in_days: 30,
		title: 'Mara'
	});

	const orig = new Map([
		[3, png()],
		[4, png()]
	]);
	const multi = buildCreateRequest({ ...base, includeOriginal: true }, orig);
	const form = multi.body as FormData;
	expect(JSON.parse(form.get('meta') as string).include_original).toBe(true);
	expect(form.get('orig-3')).toBeInstanceOf(Blob);
	expect(form.get('orig-4')).toBeInstanceOf(Blob);
	expect(multi.headers).toBeUndefined(); // the browser sets the multipart boundary itself
});

test('the settings choice maps to days', () => {
	expect(expiryDays('never')).toBeNull();
	expect(expiryDays('30')).toBe(30);
});

const shareRow = (over: Partial<ShareRow>): ShareRow => ({
	id: 'a'.repeat(26),
	url: 'https://share.example/a/' + 'a'.repeat(26),
	created_at: 1,
	expires_at: null,
	revoked_at: null,
	title: null,
	include_recipe: false,
	include_original: false,
	items: 0,
	run_ids: [],
	...over
});

test('live shared run ids ignore revoked and expired links', () => {
	const now = 1_000;
	expect(
		[
			...sharedRunIDs(
				[
					shareRow({ run_ids: [1, 2] }),
					shareRow({ run_ids: [3], revoked_at: 999 }),
					shareRow({ run_ids: [4], expires_at: 999 }),
					shareRow({ run_ids: [5, 6], expires_at: 1_001 }),
					shareRow({ run_ids: [1], expires_at: 2_000 })
				],
				now
			)
		].sort((a, b) => a - b)
	).toEqual([1, 2, 5, 6]);
});

test('features are all off when the server says no or is unreachable', async () => {
	expect(await backend([json({ share: true, fetch: false })]).b.features()).toEqual({ share: true, fetch: false });
	expect(await backend([json({ error: { code: 'not_found', message: 'x' } }, 404)]).b.features()).toEqual({
		share: false,
		fetch: false
	});
	const dead = new ShareBackend((async () => {
		throw new TypeError('offline');
	}) as unknown as typeof fetch);
	expect(await dead.features()).toEqual({ share: false, fetch: false });
});

test('API errors keep their code', async () => {
	const { b } = backend([json({ error: { code: 'originals_required', message: 'need them' } }, 400)]);
	await expect(
		b.create({ runIds: [1], includeRecipe: false, includeOriginal: true, expiresInDays: null })
	).rejects.toMatchObject({
		status: 400,
		code: 'originals_required'
	});
	expect(new ApiError(1, 'x', 'y')).toBeInstanceOf(Error);
});

test('the Worker failure codes map to catalog codes, anything else is link-blocked', async () => {
	expect(linkCode('link-not-image')).toBe('link-not-image');
	expect(linkCode('link-too-large')).toBe('link-too-large');
	expect(linkCode('link-timeout')).toBe('link-timeout');
	expect(linkCode('something-odd')).toBe('link-blocked');
	expect(linkCode(undefined)).toBe('link-blocked');
	for (const code of ['link-blocked', 'link-not-image', 'link-too-large', 'link-timeout']) {
		const { b } = backend([json({ error: { code } }, 502)]);
		await expect(b.fetchViaRelay('https://x.test/a.png')).rejects.toMatchObject({ name: 'LinkError', code });
	}
});

const on: Features = { share: true, fetch: true };

test('a link that allows CORS loads directly, with no cookies and no relay', async () => {
	const relay = backend([]);
	const direct = (async (_u: string, init?: RequestInit) => {
		expect(init?.credentials).toBe('omit');
		return new Response(png(), { headers: { 'Content-Type': 'image/png' } });
	}) as unknown as typeof fetch;
	const blob = await loadFromUrl('https://x.test/a.png', { relay: relay.b, features: on, direct });
	expect(blob.type).toBe('image/png');
	expect(relay.calls).toHaveLength(0);
});

test('a CORS or network failure falls back to the relay when there is one', async () => {
	const relay = backend([new Response(png(), { headers: { 'Content-Type': 'image/png' } })]);
	const direct = (async () => {
		throw new TypeError('Failed to fetch');
	}) as unknown as typeof fetch;
	const blob = await loadFromUrl('https://x.test/a.png', { relay: relay.b, features: on, direct });
	expect(blob.size).toBe(5);
	expect(relay.calls[0]!.url).toBe('/api/fetch');
});

test('with no relay a network failure is link-blocked', async () => {
	const direct = (async () => {
		throw new TypeError('Failed to fetch');
	}) as unknown as typeof fetch;
	await expect(
		loadFromUrl('https://x.test/a.png', { features: { share: false, fetch: false }, direct })
	).rejects.toMatchObject({
		code: 'link-blocked'
	});
});

test('a direct page that is not an image is link-not-image, with no relay attempt', async () => {
	const relay = backend([]);
	const direct = (async () =>
		new Response('<html>', { headers: { 'Content-Type': 'text/html' } })) as unknown as typeof fetch;
	const err = await loadFromUrl('https://x.test/p', { relay: relay.b, features: on, direct }).catch((e) => e);
	expect(err).toBeInstanceOf(LinkError);
	expect(err.code).toBe('link-not-image');
	expect(relay.calls).toHaveLength(0);
});

test('hasMetadata finds Exif and XMP and passes a clean PNG', () => {
	const enc = (s: string) => new TextEncoder().encode(s);
	expect(hasMetadata(enc('\xff\xd8\xff\xe1\x00\x10Exif\x00\x00II*'))).toBe(true);
	expect(hasMetadata(enc('<x:xmpmeta xmlns:x="http://ns.adobe.com/xap/1.0/">'))).toBe(true);
	expect(hasMetadata(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]))).toBe(false);
});
