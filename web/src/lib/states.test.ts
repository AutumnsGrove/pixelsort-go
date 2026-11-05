import { expect, test } from 'vitest';
import { segments, status, usage } from './states';

const lv = (g: number) => usage(g).level;

test('usage levels: ok below 40 GB, warn from 40, full from 50', () => {
	expect([0, 39.9, 40, 49.9, 50, 51.3].map(lv)).toEqual(['ok', 'ok', 'warn', 'warn', 'full', 'full']);
});
test('the percentage never rounds up into the next state (49.9 GB reads 99 %)', () => {
	expect([39.99, 40, 49.9, 51.3].map((g) => usage(g).pct)).toEqual([79, 80, 99, 102]);
});
test('nothing is said when all is well', () => expect(status({ used: 20, offline: false })).toBeNull());
test('warn says the percentage and that nothing is deleted; full says new runs still save', () => {
	const w = status({ used: 41 })!;
	const f = status({ used: 52 })!;
	expect(w.text).toMatch(/80|82/);
	expect(w.sub).toMatch(/never|nothing is deleted/i);
	expect(f.kind).toBe('full');
	expect(f.sub).toMatch(/still save/i);
	expect(f.sub).toMatch(/nothing is deleted/i);
});
test('offline outranks full and says sorting still works and how many runs wait', () => {
	const o = status({ used: 52, offline: true }, { pending: 3 })!;
	expect(o.kind).toBe('offline');
	expect(o.text).toMatch(/sorting still works/i);
	expect(o.sub).toMatch(/3 runs/);
	expect(status({ offline: true }, { pending: 1 })!.sub).toMatch(/1 run will/);
});
test('the Archive words offline differently (nothing is sorted there)', () => {
	expect(status({ offline: true }, { surface: 'archive' })!.text).toMatch(/Can’t reach your server/);
});
test('meter segments add up to the total and are never negative', () => {
	for (const [u, b] of [
		[0, 0],
		[38.2, 1.4],
		[51.3, 1.4],
		[0.5, 1.4]
	] as const) {
		const s = segments(u, b);
		expect(s.results + s.originals + s.thumbs + s.bin).toBeCloseTo(u, 9);
		for (const v of Object.values(s)) expect(v).toBeGreaterThanOrEqual(0);
	}
});
