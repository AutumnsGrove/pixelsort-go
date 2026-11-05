import { beforeEach, describe, expect, test } from 'vitest';
import { EngineClient, EngineCrashed } from './client';
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
		stepMs: 1
	});
	const deliver = (w: FakeWorker, f: ReturnType<typeof frameEvent>) =>
		w.onmessage?.({ data: f } as unknown as MessageEvent<Response>);

	test('frames reach subscribers in order and each is acknowledged after the listeners ran', async () => {
		const seen: number[] = [];
		client.onFrame((f) => seen.push(f.pass));
		const p = client.animate(30);
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
		const p = client.animate(10);
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
