import { describe, expect, it } from 'vitest';
import {
	acceptGuess,
	addPoint,
	clampRadius,
	finishStroke,
	MAX_RADIUS,
	MIN_RADIUS,
	paintKey,
	pickTool,
	strokePoints,
	suggestFor,
	toFraction
} from './brush';
import { mulberry32 } from './presets';
import type { Stroke } from './regions';

const S = { w: 400, h: 300 };

/** Deterministic noisy loop of n points around (cx, cy) in fractions. */
function loop(n: number, rx: number, ry: number, noise: number, seed: number, closed = true): [number, number][] {
	const rnd = mulberry32(seed);
	const pts: [number, number][] = [];
	for (let i = 0; i < n; i++) {
		const a = (i / (closed ? n - 1 : n * 2)) * 2 * Math.PI;
		pts.push([0.5 + (rx + (rnd() - 0.5) * noise) * Math.cos(a), 0.5 + (ry + (rnd() - 0.5) * noise) * Math.sin(a)]);
	}
	return pts;
}

describe('collecting a stroke', () => {
	it('keeps positions inside the picture', () => {
		expect(toFraction(-5, 9999, S)).toEqual([0, 1]);
		expect(toFraction(200, 150, S)).toEqual([0.5, 0.5]);
	});
	it('skips points closer than the minimum distance and never mutates', () => {
		const a: [number, number][] = [[0.5, 0.5]];
		const near = addPoint(a, [0.5 + 1 / S.w, 0.5], S, 2);
		expect(near).toHaveLength(1);
		expect(near).not.toBe(a);
		expect(addPoint(a, [0.6, 0.5], S, 2)).toHaveLength(2);
		expect(a).toHaveLength(1);
	});
	it('a single tap becomes a dot (two points in one place)', () => {
		expect(finishStroke([[0.2, 0.3]], 0.03, false)).toEqual({
			radius: 0.03,
			points: [
				[0.2, 0.3],
				[0.2, 0.3]
			]
		});
		expect(finishStroke([], 0.03, false)).toBeNull();
	});
	it('marks an erase stroke and clamps the radius', () => {
		expect(
			finishStroke(
				[
					[0, 0],
					[1, 1]
				],
				5,
				true
			)
		).toMatchObject({ erase: true, radius: MAX_RADIUS });
		expect(clampRadius(0)).toBe(MIN_RADIUS);
		expect(
			finishStroke(
				[
					[0, 0],
					[1, 1]
				],
				0.03,
				false
			)
		).not.toHaveProperty('erase');
	});
	it('writes points for drawing', () => {
		expect(
			strokePoints(
				[
					[0.5, 0.5],
					[1, 0]
				],
				S
			)
		).toBe('200,150 400,0');
	});
});

describe('"looks like a circle"', () => {
	it('suggests a circle or ellipse for a noisy loop (property over many seeds)', () => {
		for (let seed = 1; seed <= 40; seed++) {
			const stroke = finishStroke(loop(200, 0.25, 0.3, 0.02, seed), 0.03, false)!;
			const g = suggestFor(stroke, S);
			expect(g, `seed ${seed}`).not.toBeNull();
			expect(g!.kind, `seed ${seed}`).toBe('ellipse');
			expect(g!.cx).toBeCloseTo(0.5, 1);
			expect(g!.cy).toBeCloseTo(0.5, 1);
		}
	});
	it('says "circle" when the box is square in pixels', () => {
		const pts = loop(200, 0.25, 0.25 * (S.w / S.h), 0, 1);
		expect(suggestFor(finishStroke(pts, 0.03, false)!, S)?.label).toBe('circle');
	});
	it('gives null for a scribble that is not closed (property over many seeds)', () => {
		for (let seed = 1; seed <= 40; seed++) {
			const rnd = mulberry32(seed * 7919);
			const pts: [number, number][] = [];
			let x = 0.1;
			for (let i = 0; i < 120; i++) {
				x += 0.006;
				pts.push([x, 0.5 + (rnd() - 0.5) * 0.4]);
			}
			expect(suggestFor(finishStroke(pts, 0.03, false)!, S), `seed ${seed}`).toBeNull();
		}
	});
	it('gives null for an open arc, a dot, and an erase stroke', () => {
		expect(suggestFor(finishStroke(loop(200, 0.25, 0.3, 0, 1, false), 0.03, false)!, S)).toBeNull();
		expect(suggestFor(finishStroke([[0.5, 0.5]], 0.03, false)!, S)).toBeNull();
		expect(suggestFor(finishStroke(loop(200, 0.25, 0.3, 0, 1), 0.03, true)!, S)).toBeNull();
	});
});

describe('accepting a suggestion replaces the stroke', () => {
	it('removes exactly that stroke and adds one object, never both', () => {
		const strokes: Stroke[] = [
			{
				radius: 0.03,
				points: [
					[0, 0],
					[0.1, 0.1]
				]
			},
			finishStroke(loop(200, 0.25, 0.3, 0, 1), 0.03, false)!,
			{
				radius: 0.02,
				points: [
					[0.9, 0.9],
					[1, 1]
				]
			}
		];
		const g = suggestFor(strokes[1]!, S)!;
		const { strokes: rest, object } = acceptGuess(strokes, 1, g);
		expect(rest).toEqual([strokes[0], strokes[2]]);
		expect(object).toMatchObject({ kind: 'ellipse', mode: 'add', rot: 0 });
		expect(strokes).toHaveLength(3); // the input is untouched
	});
});

describe('picking a tool', () => {
	it('turns Paint or Erase off when its own chip is pressed again', () => {
		expect(pickTool('paint', 'paint')).toBe('move');
		expect(pickTool('erase', 'erase')).toBe('move');
	});
	it('switches straight between the brush tools', () => {
		expect(pickTool('move', 'paint')).toBe('paint');
		expect(pickTool('move', 'erase')).toBe('erase');
		expect(pickTool('paint', 'erase')).toBe('erase');
		expect(pickTool('erase', 'paint')).toBe('paint');
	});
	it('leaves Move alone: it is where the other tools go to stop', () => {
		expect(pickTool('move', 'move')).toBe('move');
		expect(pickTool('paint', 'move')).toBe('move');
		expect(pickTool('erase', 'move')).toBe('move');
	});
});

describe('the P key', () => {
	it('turns the protect brush on from Move, and puts whatever brush is on away', () => {
		expect(paintKey('move')).toBe('paint');
		expect(paintKey('paint')).toBe('move');
		expect(paintKey('erase')).toBe('move'); // a key press stops the brush; switching tools is the chips' job
	});
});
