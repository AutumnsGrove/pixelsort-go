import { describe, expect, test } from 'vitest';
import { ageInDays, agoText, filter, groupLabel, rows, type RunItem } from './runs-data';
import { layout, range, rowAt } from './virtual-list';

const NOW = new Date(Date.UTC(2026, 10, 2));
const MODES = ['random', 'wave', 'threshold', 'edges', 'ca'];

/** A deterministic pile of fake runs, newest first, thinning out over ~18 months. */
function make(n: number): RunItem[] {
	return Array.from({ length: n }, (_, i) => ({
		id: i,
		name: `Run ${i}, ${MODES[i % 5]}`,
		p: { mode: MODES[i % 5], key: 'luma', angle: (i * 37) % 360, rule: i % 5 === 4 ? 110 : undefined },
		age: Math.floor(Math.pow(i / Math.max(1, n), 1.6) * 540),
		starred: i % 12 === 0
	}));
}

describe('runs data', () => {
	test('group labels', () => {
		expect([0, 1, 3, 6, 7, 13].map((a) => groupLabel(a, NOW))).toEqual([
			'Today',
			'Yesterday',
			'This week',
			'This week',
			'Last week',
			'Last week'
		]);
		expect(groupLabel(30, NOW)).toBe('Oct 2026');
		expect(groupLabel(400, NOW)).toMatch(/^[A-Z][a-z]{2} 202[45]$/);
	});
	test('ageInDays and agoText', () => {
		expect(ageInDays(NOW.getTime() / 1000, NOW)).toBe(0);
		expect(ageInDays(NOW.getTime() / 1000 - 86400 * 3, NOW)).toBe(3);
		expect(ageInDays(NOW.getTime() / 1000 + 86400, NOW)).toBe(0); // a clock a little ahead is not "-1 days"
		expect([0, 1, 5, 45].map(agoText)).toEqual(['today', 'yesterday', '5 days ago', '2 mo ago']);
	});
	test('filter matches the name and the recipe words, every word', () => {
		const runs = make(100);
		expect(filter(runs, { q: 'wave' }).every((r) => /wave/.test(r.name + r.p.mode))).toBe(true);
		expect(filter(runs, { q: 'rule 110' }).every((r) => r.p.rule === 110)).toBe(true);
		expect(filter(runs, { q: 'wave luma' }).length).toBe(filter(runs, { q: 'wave' }).length);
		expect(filter(runs, { q: 'zzzz' })).toEqual([]);
		expect(filter(runs, { starred: true }).every((r) => r.starred)).toBe(true);
		expect(filter(runs, { q: '  ' })).toHaveLength(100);
	});
	test('rows: header per date group, cards in chunks, no run lost or repeated (2000 runs)', () => {
		const list = make(2000);
		for (const cols of [1, 3, 5]) {
			const { rows: r, jumps } = rows(list, { cols, now: NOW });
			const ids = r.flatMap((x) => (x.type === 'cards' ? x.items.map((i) => i.id) : []));
			expect(ids).toEqual(list.map((x) => x.id));
			expect(r.every((x) => x.type === 'head' || x.items.length <= cols)).toBe(true);
			expect(jumps.every((j) => r[j.row]?.type === 'head')).toBe(true);
			expect(new Set(jumps.map((j) => j.label)).size).toBe(jumps.length);
		}
	});
	test('rows: a non-date sort is flat', () => {
		const { rows: r, jumps } = rows(make(50), { cols: 4, sort: 'big', now: NOW });
		expect(r.every((x) => x.type === 'cards')).toBe(true);
		expect(jumps).toEqual([]);
	});
});

describe('virtual list maths', () => {
	const rs = Array.from({ length: 1000 }, (_, i) => ({ h: i % 10 === 0 ? 30 : 120 }));
	const off = layout(rs);
	test('offsets are prefix sums', () => {
		expect(off[0]).toBe(0);
		expect(off[1]).toBe(30);
		expect(off[rs.length]).toBe(rs.reduce((a, r) => a + r.h, 0));
	});
	test('rowAt finds the row containing y', () => {
		for (const y of [0, 29, 30, 31, 149, 150, 500, 12345, (off[1000] ?? 0) - 1]) {
			const i = rowAt(off, y);
			expect(off[i]!).toBeLessThanOrEqual(y);
			expect(off[i + 1]!).toBeGreaterThan(y);
		}
		expect(rowAt(off, -5)).toBe(0);
		expect(rowAt(off, 1e12)).toBe(999);
	});
	test('range covers the viewport plus overscan and stays small', () => {
		const [s, e] = range(off, 5000, 800, 400);
		expect(off[s]!).toBeLessThanOrEqual(4600);
		expect(off[e]!).toBeGreaterThanOrEqual(6200);
		expect(e - s).toBeLessThan(25);
		expect(range(off, -2000, 500, 0)).toEqual([0, 0]);
		expect(range(layout([]), 0, 500, 0)).toEqual([0, 0]);
		expect(range(off, 1e9, 500, 0)).toEqual([0, 0]);
	});
	test('the window size does not grow with the list', () => {
		const small = range(layout(rs.slice(0, 50)), 100, 800, 400);
		const big = range(off, 100, 800, 400);
		expect(big[1] - big[0]).toBe(small[1] - small[0]);
	});
});
