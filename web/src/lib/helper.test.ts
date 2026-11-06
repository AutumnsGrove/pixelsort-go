import { describe, expect, test } from 'vitest';
import { askHelper, helperEnabled, helperErrorText, HelperError, stepLabel, type HelperEvent } from './helper';

const enc = new TextEncoder();
/** A response whose body arrives in the given chunks, so lines can be split anywhere. */
function stream(chunks: string[], status = 200): Response {
	const body = new ReadableStream<Uint8Array>({
		start(c) {
			for (const s of chunks) c.enqueue(enc.encode(s));
			c.close();
		}
	});
	return new Response(body, { status, headers: { 'Content-Type': 'application/x-ndjson' } });
}
const line = (e: HelperEvent) => JSON.stringify(e) + '\n';
const img = new Blob(['x'], { type: 'image/jpeg' });

describe('asking the helper', () => {
	test('sends the prompt and the picture as a form, and nothing else', async () => {
		let seen: { url: string; init: RequestInit } | null = null;
		await askHelper({
			prompt: 'the red disc',
			image: img,
			onEvent: () => {},
			fetchFn: async (url, init) => {
				seen = { url: String(url), init: init! };
				return stream([line({ type: 'done', reason: 'proposed' })]);
			}
		});
		expect(seen!.url).toBe('/api/helper');
		expect(seen!.init.method).toBe('POST');
		const form = seen!.init.body as FormData;
		expect(form.get('prompt')).toBe('the red disc');
		expect((form.get('image') as File).type).toBe('image/jpeg');
		expect([...form.keys()].sort()).toEqual(['image', 'prompt']);
		expect(seen!.init.credentials).toBe('same-origin');
	});

	test('events are delivered in order even when a line is split across chunks', async () => {
		const got: string[] = [];
		const a = line({ type: 'start', model: 'm' });
		const b = line({ type: 'say', text: 'hello' });
		const c = line({ type: 'done', reason: 'answered' });
		await askHelper({
			prompt: 'x',
			image: img,
			onEvent: (e) => got.push(e.type),
			fetchFn: async () => stream([a.slice(0, 7), a.slice(7) + b.slice(0, 3), b.slice(3) + c])
		});
		expect(got).toEqual(['start', 'say', 'done']);
	});

	test('a line that is not an event ends the run with a stream error, after the good ones', async () => {
		const got: string[] = [];
		const err = await askHelper({
			prompt: 'x',
			image: img,
			onEvent: (e) => got.push(e.type),
			fetchFn: async () => stream([line({ type: 'start' }), 'not json\n'])
		}).catch((e) => e);
		expect(got).toEqual(['start']);
		expect(err).toBeInstanceOf(HelperError);
		expect(err.code).toBe('bad_stream');
	});

	test('a stream that stops without done is an error, not a silent success', async () => {
		const err = await askHelper({
			prompt: 'x',
			image: img,
			onEvent: () => {},
			fetchFn: async () => stream([line({ type: 'start' })])
		}).catch((e) => e);
		expect(err).toBeInstanceOf(HelperError);
		expect(err.code).toBe('bad_stream');
	});

	test('a refusal carries the server’s code and status', async () => {
		const res = new Response(JSON.stringify({ error: { code: 'busy', message: 'The helper is busy.' } }), {
			status: 429
		});
		const err = await askHelper({ prompt: 'x', image: img, onEvent: () => {}, fetchFn: async () => res }).catch(
			(e) => e
		);
		expect(err).toMatchObject({ code: 'busy', status: 429 });
		expect(helperErrorText(err)).toMatch(/busy|few seconds|try again/i);
	});

	test('an unreachable server is a network error with words a person can use', async () => {
		const err = await askHelper({
			prompt: 'x',
			image: img,
			onEvent: () => {},
			fetchFn: async () => {
				throw new TypeError('Failed to fetch');
			}
		}).catch((e) => e);
		expect(err.code).toBe('network');
		expect(helperErrorText(err)).toMatch(/reach/i);
	});

	test('cancelling stops the read and is reported as an abort, not an error to show', async () => {
		const ctl = new AbortController();
		const never = new ReadableStream<Uint8Array>({ start() {} });
		const p = askHelper({
			prompt: 'x',
			image: img,
			signal: ctl.signal,
			onEvent: () => {},
			fetchFn: async () => new Response(never, { status: 200 })
		}).catch((e) => e);
		setTimeout(() => ctl.abort(), 10);
		const err = await p;
		expect(err).toMatchObject({ name: 'AbortError' });
	});
});

describe('words for the page', () => {
	test('every tool the helper uses has a plain label, and an unknown one still reads sensibly', () => {
		for (const n of ['describe_image', 'list_objects', 'segment_from_point', 'propose_shape'])
			expect(stepLabel(n)).not.toMatch(/_/);
		expect(stepLabel('mystery_tool')).toBe('Working');
	});
	test('each server code has its own sentence, and the model-can’t-see case points at Cut out', () => {
		const t = (code: string) => helperErrorText(new HelperError(code, 'raw server text', 400));
		expect(t('no_vision')).toMatch(/Cut out this object/);
		expect(t('bad_prompt')).toBe('raw server text');
		expect(new Set(['busy', 'network', 'model_unavailable', 'bad_stream'].map(t)).size).toBe(4);
	});
});

describe('is the helper on', () => {
	test('only when the server says so; an old or unreachable server has none', async () => {
		const on = async () => new Response(JSON.stringify({ share: false, fetch: false, helper: true }));
		const off = async () => new Response(JSON.stringify({ share: true, fetch: true }));
		const dead = async () => {
			throw new TypeError('x');
		};
		expect(await helperEnabled(on)).toBe(true);
		expect(await helperEnabled(off)).toBe(false);
		expect(await helperEnabled(dead)).toBe(false);
	});
});
