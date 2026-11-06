import { describe, expect, test } from 'vitest';
import { colorName, cutoutName, outlinePathD, outlineSvg, refusalText } from './cutout-shape';

const square: [number, number][] = [
	[10, 10],
	[30, 10],
	[30, 20],
	[10, 20]
];
const bbox: [number, number, number, number] = [10, 10, 21, 11];

describe('the outline becomes an SVG the shape library already reads', () => {
	test('the path is the outline moved to the corner, with the same shape', () => {
		const d = outlinePathD(square, bbox);
		const pts = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m): [number, number] => [
			Number(m[1]),
			Number(m[2])
		]);
		expect(pts).toHaveLength(4);
		// the same distances between corners as the original, whatever the shift
		const [p0, p1, p2] = pts as [number, number][];
		expect([p1![0] - p0![0], p2![1] - p1![1]]).toEqual([20, 10]);
		// moved so the shape starts near the corner, not where it sat in the picture
		expect(Math.min(...pts.map((p) => p[0]!))).toBeLessThan(5);
		expect(Math.min(...pts.map((p) => p[1]!))).toBeLessThan(5);
		expect(d.startsWith('M')).toBe(true);
		expect(d.endsWith('Z')).toBe(true);
	});

	test('the svg is a closed path with a viewBox that holds it', () => {
		const svg = outlineSvg(square, bbox);
		expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 25 15">/);
		expect(svg.match(/<path /g)).toHaveLength(1);
		expect(svg).toMatch(/d="M[^"]*Z"/);
		expect(svg).not.toMatch(/script|on\w+=|href/i); // data only
	});

	test('numbers are plain and finite, whatever comes in', () => {
		const d = outlinePathD(
			[
				[1, 1],
				[Number.NaN, 2],
				[3, 3]
			],
			[0, 0, 4, 4]
		);
		expect(d).not.toMatch(/NaN|Infinity/);
	});
});

describe('naming a shape', () => {
	test('by its colour, in plain words', () => {
		expect(colorName([200, 60, 30])).toBe('red');
		expect(colorName([230, 150, 40])).toBe('orange');
		expect(colorName([40, 80, 200])).toBe('blue');
		expect(colorName([40, 160, 70])).toBe('green');
		expect(colorName([128, 128, 128])).toBe('grey');
		expect(colorName([10, 10, 14])).toBe('dark grey');
		expect(colorName([240, 240, 235])).toBe('pale grey');
		expect(colorName([10, 20, 90])).toBe('dark blue');
	});
	test('a shape name is short, capitalised and never empty', () => {
		expect(cutoutName([200, 60, 30])).toBe('Red shape');
		expect(cutoutName([10, 20, 90])).toBe('Dark blue shape');
		for (const m of [
			[0, 0, 0],
			[255, 255, 255],
			[Number.NaN, 0, 0]
		] as [number, number, number][])
			expect(cutoutName(m).length).toBeGreaterThan(4);
	});
});

describe('when the engine says no', () => {
	test('each refusal says what to try, in words a person can use', () => {
		expect(refusalText('too-big')).toMatch(/too much of the picture/);
		expect(refusalText('too-big')).toMatch(/lower the tolerance|more distinct/i);
		expect(refusalText('too-small')).toMatch(/too small|thin/);
		expect(refusalText('too-small')).toMatch(/raise the tolerance|bigger/i);
	});
});
