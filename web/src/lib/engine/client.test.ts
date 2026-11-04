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
