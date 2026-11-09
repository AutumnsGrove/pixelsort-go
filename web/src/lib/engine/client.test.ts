import { beforeEach, describe, expect, test } from 'vitest';
import { EngineClient, EngineCrashed } from './client';
import { EngineDownloadFailed } from './loader';
import { defaultParams } from './params';
import type { Request, Response } from './protocol';

class FakeWorker {
	sent: Request[] = [];
	transfers: Transferable[][] = [];
	terminated = false;
	onmessage: ((e: MessageEvent<Response>) => void) | null = null;
	onerror: ((e: ErrorEvent) => void) | null = null;
	postMessage(m: Request, t: Transferable[] = []) {
		this.sent.push(m);
		this.transfers.push(t);
	}
	terminate() {
		this.terminated = true;
	}
	reply(r: Response) {
		this.onmessage?.({ data: r } as MessageEvent<Response>);
	}
	fail(message: string) {
		this.onerror?.({ message } as ErrorEvent);
	}
}

const runReply = (id: number, tag: number): Response => ({
	id,
	ok: true,
	stats: { lines: 1, intervals: 1, sortable: 1, frozen: 0 },
	rgba: new Uint8Array([tag, 0, 0, 255]).buffer,
	timings: { prepareMs: 1, sortMs: 1, transferMs: 1 }
});

let workers: FakeWorker[];
let client: EngineClient;
beforeEach(() => {
	workers = [];
	client = new EngineClient(() => {
		const w = new FakeWorker();
		workers.push(w);
		return w as unknown as Worker;
	});
});
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('requests', () => {
	test('ids increase and out-of-order answers reach the right promise', async () => {
		const a = client.configure({ angle: 10 });
		const b = client.setSoft(3);
		const w = workers[0]!;
		expect(w.sent.map((m) => m.id)).toEqual([1, 2]);
		w.reply({ id: 2, ok: false, error: 'second failed' });
		w.reply({ id: 1, ok: true });
		await expect(a).resolves.toBeUndefined();
		await expect(b).rejects.toThrow('second failed');
	});

	test('configure merges and sends the full recipe each time', async () => {
		const a = client.configure({ angle: 45 });
		workers[0]!.reply({ id: 1, ok: true });
		await a;
		const b = client.configure({ seed: 9 });
		workers[0]!.reply({ id: 2, ok: true });
		await b;
		const last = workers[0]!.sent[1] as Extract<Request, { type: 'configure' }>;
		expect(JSON.parse(last.json)).toMatchObject({ angle: 45, seed: 9, mode: 'random' });
	});

	test('maxPasses asks the engine for its bound', async () => {
		const p = client.maxPasses();
		expect(workers[0]!.sent[0]).toMatchObject({ type: 'maxPasses' });
		workers[0]!.reply({ id: 1, ok: true, passes: 42 });
		await expect(p).resolves.toBe(42);
	});

	test('setImage does not detach the callers array', async () => {
		const px = new Uint8ClampedArray([1, 2, 3, 255]);
		const p = client.setImage(px);
		workers[0]!.reply({ id: 1, ok: true });
		await p;
		expect(px.byteLength).toBe(4);
		expect(Array.from(px)).toEqual([1, 2, 3, 255]);
		expect(workers[0]!.transfers[0]).toHaveLength(1);
	});
});

describe('run: latest wins', () => {
	test('three runs while the first is in flight: first, superseded, third', async () => {
		const r1 = client.run();
		const r2 = client.run();
		const r3 = client.run();
		const w = workers[0]!;
		expect(w.sent).toHaveLength(1);
		w.reply(runReply(1, 11));
		await expect(r2).resolves.toBe('superseded');
		const first = await r1;
		expect(first).not.toBe('superseded');
		await tick();
		expect(w.sent).toHaveLength(2);
		w.reply(runReply(2, 33));
		const third = await r3;
		expect(third === 'superseded' ? null : third.rgba[0]).toBe(33);
	});

	test('a failed run rejects with the engine message', async () => {
		const r = client.run();
		workers[0]!.reply({ id: 1, ok: false, error: 'boom' });
		await expect(r).rejects.toThrow('boom');
	});
});

describe('crashes', () => {
	test('a worker error rejects every pending promise and the next call makes a new worker', async () => {
		const a = client.configure({});
		const r = client.run();
		const r2 = client.run();
		workers[0]!.fail('out of memory');
		await expect(a).rejects.toBeInstanceOf(EngineCrashed);
		await expect(r).rejects.toBeInstanceOf(EngineCrashed);
		await expect(r2).rejects.toBeInstanceOf(EngineCrashed);
		expect(workers[0]!.terminated).toBe(true);
		const next = client.setSoft(1);
		expect(workers).toHaveLength(2);
		workers[1]!.reply({ id: workers[1]!.sent[0]!.id, ok: true });
		await next;
	});
});

describe('animation', () => {
	const frameEvent = (tag: number, done = false) => ({
		event: 'frame' as const,
		rgba: new Uint8Array([tag, 0, 0, 255]).buffer,
		progress: done ? 1 : 0.5,
		pass: tag,
		done,
		stepMs: 1,
		rewinding: false,
		finished: done,
		home: false
	});
	const deliver = (w: FakeWorker, f: ReturnType<typeof frameEvent>) =>
		w.onmessage?.({ data: f } as unknown as MessageEvent<Response>);

	test('frames reach subscribers in order and each is acknowledged after the listeners ran', async () => {
		const seen: number[] = [];
		client.onFrame((f) => seen.push(f.pass));
		const p = client.animate(30, false);
		const w = workers[0]!;
		w.reply({ id: 1, ok: true, stats: { lines: 1, intervals: 1, sortable: 1, frozen: 0 } });
		await p;
		deliver(w, frameEvent(1));
		expect(w.sent.at(-1)?.type).toBe('ack');
		deliver(w, frameEvent(2));
		deliver(w, frameEvent(3, true));
		expect(seen).toEqual([1, 2, 3]);
		expect(w.sent.filter((m) => m.type === 'ack')).toHaveLength(3);
	});

	test('unsubscribing stops delivery', () => {
		const seen: number[] = [];
		const off = client.onFrame((f) => seen.push(f.pass));
		client.pause();
		off();
		deliver(workers[0]!, frameEvent(1));
		expect(seen).toEqual([]);
	});

	test('pause, resume, setSpeed and restart are sent as requests', async () => {
		const calls = [client.pause(), client.resume(), client.setSpeed('auto'), client.restart()];
		const w = workers[0]!;
		expect(w.sent.map((m) => m.type)).toEqual(['pause', 'resume', 'setSpeed', 'restart']);
		w.sent.forEach((m) => w.reply({ id: m.id, ok: true }));
		await Promise.all(calls);
	});

	test('a failed animate rejects with the message', async () => {
		const p = client.animate(10, false);
		workers[0]!.reply({ id: 1, ok: false, error: 'configure first' });
		await expect(p).rejects.toThrow('configure first');
	});
});

describe('seek: latest wins', () => {
	const seekReply = (id: number, pass: number, done = false): Response => ({
		id,
		ok: true,
		rgba: new Uint8Array([pass, 0, 0, 255]).buffer,
		seek: { pass, progress: pass / 100, done }
	});

	test('five seeks while the first is in flight: first, four superseded but the newest, which runs last', async () => {
		const results = [10, 20, 30, 40, 50].map((p) => client.seek(p));
		const w = workers[0]!;
		expect(w.sent.map((m) => (m.type === 'seek' ? m.pass : -1))).toEqual([10]); // only the first is sent
		w.reply(seekReply(1, 10));
		await tick();
		expect(w.sent.map((m) => (m.type === 'seek' ? m.pass : -1))).toEqual([10, 50]); // then only the newest
		w.reply(seekReply(2, 50, true));
		const [first, ...rest] = await Promise.all(results);
		expect(first === 'superseded' || first === undefined ? null : first.pass).toBe(10);
		expect(rest.slice(0, 3)).toEqual(['superseded', 'superseded', 'superseded']);
		const last = rest[3]!;
		expect(last === 'superseded' ? null : [last.pass, last.done, last.rgba[0]]).toEqual([50, true, 50]);
	});

	test('a failed seek rejects and the next one still goes out', async () => {
		const a = client.seek(5);
		const b = client.seek(6);
		workers[0]!.reply({ id: 1, ok: false, error: 'not prepared' });
		await expect(a).rejects.toThrow('not prepared');
		await tick();
		expect(workers[0]!.sent).toHaveLength(2);
		workers[0]!.reply(seekReply(2, 6));
		await expect(b).resolves.toMatchObject({ pass: 6 });
	});
});

describe('loading the engine', () => {
	test('download progress from the worker reaches listeners, and stops after unsubscribing', async () => {
		const seen: { loaded: number; total: number | null; attempt: number }[] = [];
		const ready: boolean[] = [];
		const off = client.onLoading((p) => (p ? seen.push(p) : ready.push(true)));
		client.configure({ angle: 1 }).catch(() => {}); // starts the worker
		const w = workers[0]!;
		w.onmessage?.({ data: { event: 'loading', loaded: 10, total: 100, attempt: 1 } } as never);
		w.onmessage?.({ data: { event: 'loading', loaded: 100, total: 100, attempt: 1 } } as never);
		w.onmessage?.({ data: { event: 'loaded' } } as never);
		off();
		w.onmessage?.({ data: { event: 'loading', loaded: 1, total: 100, attempt: 2 } } as never);
		expect(seen).toEqual([
			{ loaded: 10, total: 100, attempt: 1 },
			{ loaded: 100, total: 100, attempt: 1 }
		]);
		expect(ready).toEqual([true]);
	});

	test('loading events are never mistaken for animation frames', async () => {
		const frames: number[] = [];
		client.onFrame((f) => frames.push(f.pass));
		client.configure({}).catch(() => {});
		workers[0]!.onmessage?.({ data: { event: 'loading', loaded: 5, total: null, attempt: 1 } } as never);
		expect(frames).toEqual([]);
		expect(workers[0]!.sent.map((m) => m.type)).toEqual(['configure']); // no stray ack
	});

	test('a failed download rejects with EngineDownloadFailed, not a plain Error', async () => {
		const p = client.init(10, 10);
		workers[0]!.reply({
			id: 1,
			ok: false,
			error: 'engine download failed',
			download: { attempts: 2, reason: 'http 503', url: '/engine.wasm' }
		});
		const err = await p.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(EngineDownloadFailed);
		expect((err as EngineDownloadFailed).reason).toBe('http 503');
		expect((err as EngineDownloadFailed).attempts).toBe(2);
	});

	test('after a failed download, dispose starts a fresh worker that downloads again', async () => {
		const first = client.init(10, 10);
		workers[0]!.reply({
			id: 1,
			ok: false,
			error: 'x',
			download: { attempts: 2, reason: 'timeout', url: '/engine.wasm' }
		});
		await first.catch(() => {});
		client.dispose();
		expect(workers[0]!.terminated).toBe(true);
		client.init(10, 10).catch(() => {});
		expect(workers).toHaveLength(2);
	});
});

describe('rule previews', () => {
	test('caPreview asks for one rule and gets back the mask with its size', async () => {
		const p = client.caPreview({ ...defaultParams, caSpace: 'line', angle: 37 }, 30);
		const w = workers[0]!;
		expect(w.sent[0]).toMatchObject({ type: 'caPreview', rule: 30 });
		// the recipe goes with the question, so the answer never depends on what was configured before
		expect(JSON.parse((w.sent[0] as { json: string }).json)).toMatchObject({ caSpace: 'line', angle: 37 });
		w.reply({ id: 1, ok: true, mask: new Uint8Array([0, 1, 1, 0]).buffer, preview: { w: 2, h: 2 } });
		const r = await p;
		expect(r.w).toBe(2);
		expect(r.h).toBe(2);
		expect([...r.mask]).toEqual([0, 1, 1, 0]);
	});

	test('a refused preview rejects with the engine\u2019s words', async () => {
		const p = client.caPreview(defaultParams, 999);
		workers[0]!.reply({ id: 1, ok: false, error: 'rule 999 is outside 0..255' });
		await expect(p).rejects.toThrow('outside 0..255');
	});

	test('an answer without a mask is an error, not an empty picture', async () => {
		const p = client.caPreview(defaultParams, 30);
		workers[0]!.reply({ id: 1, ok: true });
		await expect(p).rejects.toThrow();
	});
});

describe('cut out this object', () => {
	test('asks for a point as fractions and tolerance, and hands back the outline as pairs', async () => {
		const p = client.cutOut(0.5, 0.25, 32);
		const w = workers[0]!;
		expect(w.sent[0]).toMatchObject({ type: 'cutOut', x: 0.5, y: 0.25, tolerance: 32 });
		w.reply({
			id: 1,
			ok: true,
			cutout: {
				points: new Int32Array([10, 10, 20, 10, 20, 20, 10, 20]).buffer,
				pointsBefore: 80,
				area: 100,
				w: 30,
				bbox: new Int32Array([10, 10, 11, 11]).buffer,
				mean: new Int32Array([200, 60, 30]).buffer,
				mask: new Uint8Array(900).buffer
			}
		});
		const r = await p;
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.outline).toEqual([
			[10, 10],
			[20, 10],
			[20, 20],
			[10, 20]
		]);
		expect(r.bbox).toEqual([10, 10, 11, 11]);
		expect(r.mean).toEqual([200, 60, 30]);
		expect(r.pointsBefore).toBe(80);
		expect(r.area).toBe(100);
		expect(r.mask.length).toBe(900);
	});

	test('a refusal is an answer, not an error: it says why', async () => {
		for (const reason of ['too-big', 'too-small'] as const) {
			const p = client.cutOut(0.1, 0.1, 30);
			const id = workers[workers.length - 1]!.sent.at(-1)!.id;
			workers[workers.length - 1]!.reply({ id, ok: true, refused: { reason, message: 'm' } });
			expect(await p).toEqual({ ok: false, reason, message: 'm' });
		}
	});

	test('a real failure rejects', async () => {
		const p = client.cutOut(0.1, 0.1, 30);
		workers[0]!.reply({ id: 1, ok: false, error: 'not initialised' });
		await expect(p).rejects.toThrow('not initialised');
	});

	test('an answer with neither an outline nor a refusal is an error', async () => {
		const p = client.cutOut(0.1, 0.1, 30);
		workers[0]!.reply({ id: 1, ok: true });
		await expect(p).rejects.toThrow();
	});
});
