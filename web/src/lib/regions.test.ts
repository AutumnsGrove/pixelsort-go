import { expect, test } from 'vitest';
import { classCount, classDefsToEngine, defaultTiling, describeClass } from './regions';

test('class counts follow the pattern', () => {
	expect([
		classCount('all', 5),
		classCount('checker', 5),
		classCount('thirds', 5),
		classCount('random', 4),
		classCount('random', 0),
		classCount('random', 99)
	]).toEqual([1, 2, 3, 4, 1, 8]);
});

test('class definitions for the engine: gaps frozen, only set fields sent', () => {
	const defs = classDefsToEngine({ 1: { frozen: true }, 2: { angle: 90, reverse: false } }, 3);
	expect(defs).toEqual([{ frozen: true }, { frozen: true }, { angle: 90, reverse: false }, {}]);
});

test('describeClass reads like a sentence fragment', () => {
	expect(describeClass({})).toBe('same as the rest');
	expect(describeClass({ frozen: true, angle: 5 })).toBe('frozen');
	expect(describeClass({ angle: 90, key: 'hue', reverse: true, algo: 'merge' })).toBe(
		'90° · by hue · reversed · merge'
	);
});

test('a new tiling starts as checkered cells with a small gap', () => {
	expect(defaultTiling('hexagon', 7)).toMatchObject({ shape: 'hexagon', pattern: 'checker', gap: 6, seed: 7 });
});
