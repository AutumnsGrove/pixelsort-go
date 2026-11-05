import { describe, expect, it } from 'vitest';
import {
	buildShape,
	needsTidy,
	normalizeRings,
	ringArea,
	ringsPath,
	simplifyRing,
	splitRings,
	statsText,
	type Piece,
	type Point,
	type Ring
} from './shape-tidy';

const box = (x0: number, y0: number, x1: number, y1: number): Ring => [
	[x0, y0],
	[x1, y0],
	[x1, y1],
	[x0, y1]
];
const circle = (cx: number, cy: number, r: number, n = 120): Ring =>
	Array.from({ length: n }, (_, i): Point => [
		cx + r * Math.cos((i / n) * 2 * Math.PI),
		cy + r * Math.sin((i / n) * 2 * Math.PI)
	]);
const piece = (...rings: Ring[]): Piece => ({
	rings,
	len: rings.reduce((n, r) => n + r.length, 0) + ringArea(rings[0]!) / 1e6
});
const raw = (...pieces: Piece[]) => ({ pieces, elements: pieces.length });

const DONUT = raw(piece(box(0, 0, 100, 100), box(30, 30, 70, 70)));
const TWO = raw(piece(box(0, 0, 40, 40), box(60, 60, 100, 100)));
const MIXED = raw(piece(box(0, 0, 60, 60), box(15, 15, 45, 45), box(80, 80, 100, 100)));
const SMALLHOLE = raw(piece(box(0, 0, 100, 100), box(45, 45, 55, 55)));

describe('buildShape', () => {
	it('treats the inner ring of a donut as a hole', () => {
		const s = buildShape(DONUT);
		expect(s.stats).toMatchObject({ holes: 1, pieces: 1, rings: 2 });
		expect(s.more).toHaveLength(1);
	});
	it('counts two separate rings in one path as two pieces, not a hole', () => {
		expect(buildShape(TWO).stats).toMatchObject({ pieces: 2, holes: 0 });
	});
	it('reads a donut plus a loose square as 2 pieces and 1 hole', () => {
		const s = buildShape(MIXED);
		expect(s.stats).toMatchObject({ pieces: 2, holes: 1 });
		expect(s.info).toBe('2 pieces, 1 hole, 12 points');
	});
	it('keeps just the largest element, or all of them, which turns a nested circle into a hole', () => {
		const two = raw(piece(box(0, 0, 100, 100)), piece(circle(50, 50, 20)));
		expect(buildShape(two, { pieces: 'largest' }).stats).toMatchObject({ holes: 0, rings: 1 });
		expect(buildShape(two, { pieces: 'all' }).stats).toMatchObject({ holes: 1, rings: 2 });
	});
	it('drops the holes when asked, and says how many rings it left out', () => {
		const s = buildShape(DONUT, { holes: false });
		expect(s.stats).toMatchObject({ holes: 0, droppedRings: 1 });
		expect(s.more).toHaveLength(0);
	});
	it('fills a hole under the threshold and keeps it above', () => {
		expect(buildShape(SMALLHOLE, { minHole: 0.05 }).stats.holes).toBe(0);
		expect(buildShape(SMALLHOLE, { minHole: 0.005 }).stats.holes).toBe(1);
	});
	it('simplify cuts a circle to far fewer points, never below three, and keeps its area', () => {
		const c = raw(piece(circle(50, 50, 45, 240)));
		const full = buildShape(c);
		const simple = buildShape(c, { simplify: 0.01 });
		expect(simple.stats.points).toBeLessThan(full.stats.points / 2);
		expect(simple.stats.points).toBeGreaterThanOrEqual(3);
		expect(Math.abs(ringArea(simple.poly) - ringArea(full.poly)) / ringArea(full.poly)).toBeLessThan(0.06);
	});
	it('simplify keeps every ring', () => {
		const s = buildShape(MIXED, { simplify: 0.15 });
		expect(s.stats.rings).toBe(3);
		expect(s.stats.points).toBeGreaterThanOrEqual(9);
	});
	it('fits every ring into the unit square together', () => {
		for (const r of [DONUT, MIXED]) {
			const s = buildShape(r);
			for (const ring of [s.poly, ...s.more])
				for (const [x, y] of ring) {
					expect(x).toBeGreaterThanOrEqual(-1e-9);
					expect(x).toBeLessThanOrEqual(1 + 1e-9);
					expect(y).toBeGreaterThanOrEqual(-1e-9);
					expect(y).toBeLessThanOrEqual(1 + 1e-9);
				}
		}
	});
	it('does not fall over on a file with no pieces', () => {
		const s = buildShape({ pieces: [], elements: 0 });
		expect(s.poly).toEqual([]);
		expect(s.stats.points).toBe(0);
	});
});

describe('needsTidy', () => {
	it('lets a plain shape straight in and asks about holes or several pieces', () => {
		expect(needsTidy(raw(piece(circle(50, 50, 40))))).toBe(false);
		expect(needsTidy(DONUT)).toBe(true);
		expect(needsTidy(raw(piece(box(0, 0, 100, 100)), piece(circle(50, 50, 20))))).toBe(true);
	});
	it('asks when there are a lot of points', () => {
		expect(needsTidy(raw(piece(circle(50, 50, 40, 400))))).toBe(true);
	});
});

describe('ringsPath', () => {
	it('draws every ring as its own closed sub-path, scaled to the box', () => {
		expect(
			ringsPath(
				[
					[
						[0, 0],
						[1, 0],
						[1, 1]
					],
					[
						[0.25, 0.25],
						[0.5, 0.25],
						[0.5, 0.5]
					]
				],
				40
			)
		).toBe('M0 0L40 0L40 40ZM10 10L20 10L20 20Z');
		expect(ringsPath([], 40)).toBe('');
	});
});

describe('statsText', () => {
	it('pluralises', () => {
		expect(statsText({ points: 84, rings: 3, holes: 1, pieces: 2, droppedRings: 0 })).toBe(
			'2 pieces, 1 hole, 84 points'
		);
		expect(statsText({ points: 1, rings: 1, holes: 0, pieces: 1, droppedRings: 0 })).toBe('1 piece, 1 point');
		expect(statsText({ points: 9, rings: 3, holes: 2, pieces: 1, droppedRings: 0 })).toBe('1 piece, 2 holes, 9 points');
	});
});

describe('splitRings', () => {
	it('starts a new ring where the path jumps and drops slivers', () => {
		const a: Point[] = [
			[0, 0],
			[1, 0],
			[2, 0],
			[3, 0]
		];
		const b: Point[] = [
			[50, 50],
			[51, 50],
			[52, 50]
		];
		const rings = splitRings([...a, ...b, [90, 90]], 1);
		expect(rings).toHaveLength(2);
		expect(rings[0]).toHaveLength(4);
		expect(rings[1]).toHaveLength(3); // the stray point after the last jump is a one-point sliver and is dropped
	});
	it('returns nothing for no points', () => {
		expect(splitRings([], 1)).toEqual([]);
	});
});

describe('normalizeRings / simplifyRing', () => {
	it('centres and scales to 92 % of the unit square', () => {
		const [r] = normalizeRings([box(10, 10, 30, 20)]);
		const xs = r!.map((p) => p[0]);
		const ys = r!.map((p) => p[1]);
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.92);
		expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0.5);
	});
	it('leaves tiny rings and zero tolerance alone', () => {
		expect(simplifyRing(box(0, 0, 1, 1), 5)).toHaveLength(4);
		expect(simplifyRing(circle(0, 0, 1), 0)).toHaveLength(120);
	});
});
