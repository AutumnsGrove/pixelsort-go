import { expect, test } from 'vitest';
import { classCount, defaultTiling } from './regions';

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

test('a new tiling starts as checkered cells with a small gap', () => {
	expect(defaultTiling('hexagon', 7)).toMatchObject({ shape: 'hexagon', pattern: 'checker', gap: 6, seed: 7 });
});
