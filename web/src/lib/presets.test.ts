import { describe, expect, test } from 'vitest';
import { BUILTIN, OWNED, chips, diff, fromParams, mulberry32, roll, rolls, type Recipe, type Spec } from './presets';

const base: Recipe = { mode: 'random', length: 40, randomness: 10, lo: 51, hi: 209, edge: 26, angle: 0, key: 'luma', reverse: false };
const inRange = (v: number, [lo = 0, hi = 0, step = 1]: number[]) => v >= Math.round(lo) - 1e-9 && v <= Math.round(hi) + 1e-9;

test('the eight built-ins from the Python app, in order', () => {
	expect(BUILTIN.map((p) => p.name).join()).toBe('Main,File,Random,Kims,Gentle,Intense,Waves,Edges');
});

test('every roll stays in its range, pick-list and sets every owned field, keeping lo < hi (8 presets x 400 seeds)', () => {
	let bad = 0;
	for (const p of BUILTIN)
		for (let s = 1; s <= 400; s++) {
			const r = roll(p, mulberry32(s), base) as unknown as Record<string, unknown>;
			for (const [k, v] of Object.entries(p.spec)) {
				if (Array.isArray(v)) {
					if (!inRange(r[k] as number, v)) bad++;
					if (!Number.isInteger(r[k]) && ['length', 'randomness', 'lo', 'hi', 'angle'].includes(k)) bad++;
				} else if (typeof v === 'object' && 'pick' in v) {
					if (!v.pick.includes(r[k] as string)) bad++;
				} else if (r[k] !== v) bad++;
			}
			for (const k of OWNED) if (!(k in r)) bad++;
			if ((r.lo as number) >= (r.hi as number)) bad++;
		}
	expect(bad).toBe(0);
});

test('same seed, same roll; different seeds re-roll Main (the Python app gave one result)', () => {
	const main = BUILTIN[0]!;
	expect(roll(main, mulberry32(5), base)).toEqual(roll(main, mulberry32(5), base));
	const distinct = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(roll(main, mulberry32(i), base)))).size;
	expect(distinct).toBeGreaterThan(40);
});

test('Gentle, Intense, Waves and Edges are fixed; Main, File, Random and Kims roll', () => {
	const by = (id: string) => BUILTIN.find((p) => p.id === id)!;
	for (const id of ['gentle', 'intense', 'waves', 'edges']) expect(rolls(by(id)), id).toBe(false);
	for (const id of ['main', 'file', 'random', 'kims']) expect(rolls(by(id)), id).toBe(true);
});

test('Gentle matches the Python values (in engine units)', () => {
	const g = roll(BUILTIN.find((p) => p.id === 'gentle')!, Math.random, base);
	expect(g).toMatchObject({ randomness: 5, length: 13, lo: 77, hi: 178, key: 'luma' });
});

test('a saved "roll a little" preset wraps angle across 0 and stays within its spread', () => {
	const spec = fromParams({ ...base, angle: 350, length: 100, randomness: 3 }, true);
	for (let s = 0; s < 300; s++) {
		const r = roll({ spec }, mulberry32(s), base);
		expect(r.angle).toBeGreaterThanOrEqual(0);
		expect(r.angle).toBeLessThanOrEqual(359);
		expect(r.angle >= 330 || r.angle <= 10).toBe(true);
		expect(r.randomness).toBeLessThanOrEqual(13);
		expect(r.length >= 70 && r.length <= 130).toBe(true);
	}
	expect(rolls({ spec: fromParams(base, false) })).toBe(false);
});

test('diff names the fields you changed after applying', () => {
	expect(diff({ ...base }, { ...base })).toEqual([]);
	expect(diff({ ...base }, { ...base, angle: 9 })).toEqual(['angle']);
	expect(diff(null, base)).toEqual([]);
});

test('chips show the mode and angle of a card', () => {
	expect(chips(BUILTIN.find((p) => p.id === 'kims')!)).toEqual(['threshold', '90°']);
	expect(chips({ spec: { mode: { pick: ['a'] }, angle: [0, 359] } as Spec })).toEqual(['any', '0–359°']);
});
