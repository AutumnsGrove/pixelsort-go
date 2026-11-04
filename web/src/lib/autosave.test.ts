import { expect, test } from 'vitest';
import { Autosaver, BACKOFF_MS, DEBOUNCE_MS, type Timers } from './autosave';

function fakeTimers() {
	let now = 0;
	let id = 0;
	const q = new Map<number, { at: number; f: () => void }>();
	const timers: Timers = {
		set: (f, ms) => {
			q.set(++id, { at: now + ms, f });
			return id;
		},
		clear: (h) => void q.delete(h as number)
	};
	const advance = async (ms: number) => {
		const end = now + ms;
		for (;;) {
			const next = [...q.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
			if (!next) break;
			q.delete(next[0]);
			now = next[1].at;
			next[1].f();
			for (let i = 0; i < 6; i++) await Promise.resolve();
		}
		now = end;
	};
	return { timers, advance };
}

test('five rapid previews then silence save once, after the quiet period', async () => {
	const { timers, advance } = fakeTimers();
	const saved: string[] = [];
	const a = new Autosaver(async (k) => void saved.push(k), undefined, timers);
	for (let i = 0; i < 5; i++) {
		a.schedule('k' + i);
		await advance(500);
	}
	await advance(DEBOUNCE_MS);
	expect(saved).toEqual(['k4']);
});

test('the same recipe twice saves once', async () => {
	const { timers, advance } = fakeTimers();
	const saved: string[] = [];
	const a = new Autosaver(async (k) => void saved.push(k), undefined, timers);
	a.schedule('same', true);
	await advance(10);
	a.schedule('same', true);
	await advance(10);
	expect(saved).toEqual(['same']);
});

test('a failing backend retries on the backoff schedule and never throws', async () => {
	const { timers, advance } = fakeTimers();
	let calls = 0;
	const failures: number[] = [];
	const a = new Autosaver(
		async () => {
			calls++;
			throw new Error('down');
		},
		(_e, n) => failures.push(n),
		timers
	);
	a.schedule('k', true);
	await advance(1);
	expect(calls).toBe(1);
	await advance(BACKOFF_MS[0]! - 5);
	expect(calls).toBe(1);
	await advance(10);
	expect(calls).toBe(2);
	await advance(BACKOFF_MS[1]! + 1);
	await advance(BACKOFF_MS[2]! + 1);
	expect(calls).toBe(4);
	await advance(10 * BACKOFF_MS[2]!);
	expect(calls).toBe(4); // gives up after the schedule
	expect(failures).toEqual([0, 1, 2, 3]);
	expect(a.failed).toBe(true);
});
