import { describe, expect, test } from 'vitest';
import { patternLabel, patternVersion, previewLabel, previewPixels, previewVersion } from './rule-preview';
import { defaultTiling } from './regions';

describe('drawing a rule preview', () => {
	test('cells are paper on ink, fully opaque, one pixel per cell', () => {
		const px = previewPixels(new Uint8Array([1, 0, 0, 1]), 2, 2);
		expect(px.length).toBe(2 * 2 * 4);
		const at = (i: number) => [...px.slice(i * 4, i * 4 + 4)];
		expect(at(0)).toEqual([236, 228, 211, 255]);
		expect(at(1)).toEqual([20, 17, 15, 255]);
		expect(at(3)).toEqual(at(0));
	});
	test('a mask that does not fit its size is refused rather than drawn skewed', () => {
		expect(() => previewPixels(new Uint8Array(5), 2, 2)).toThrow();
		expect(() => previewPixels(new Uint8Array(0), 0, 0)).toThrow();
	});
});

describe('what the preview says about itself', () => {
	test('image space names the rule and the space', () => {
		expect(previewLabel(30, 'image', 0)).toBe('Rule 30 · image space');
	});
	test('line space says it follows the direction, with the angle', () => {
		expect(previewLabel(110, 'line', 37)).toBe('Rule 110 · line space, turning with the 37° direction');
	});
});

describe('the pattern preview', () => {
	test('names the drawing, and says when the lines are the cells', () => {
		expect(patternLabel({ family: 'grid', variant: 'iso', invert: false })).toBe('grid / iso');
		expect(patternLabel({ family: 'radial', variant: 'spiral', invert: true })).toContain('lines are the cells');
	});
	test('its version changes with every knob that draws the pattern', () => {
		const base = defaultTiling('pattern', 7);
		const v = patternVersion(base);
		for (const patch of [
			{ family: 'grid' },
			{ variant: 'iso' },
			{ size: 120 },
			{ gap: 20 },
			{ rotate: 45 },
			{ detail: 9 },
			{ invert: true },
			{ seed: 8 }
		])
			expect(patternVersion({ ...base, ...patch })).not.toBe(v);
		// how the cells are classed draws nothing, so it is not part of the picture
		expect(patternVersion({ ...base, pattern: 'thirds' })).toBe(v);
	});
});

describe('knowing when a preview is out of date', () => {
	test('only what shapes the picture is in the version', () => {
		const base = { caSpace: 'image', angle: 0, cell: 8, caBoundary: 'random', seed: 7 } as const;
		const v = (o: object, rule = 30) => previewVersion({ ...base, ...o }, rule);
		expect(v({})).toBe(v({}));
		expect(v({}, 110)).not.toBe(v({}, 30));
		expect(v({ caSpace: 'line' })).not.toBe(v({}));
		expect(v({ cell: 20 })).not.toBe(v({}));
		expect(v({ caBoundary: 'wrap' })).not.toBe(v({}));
		expect(v({ seed: 8 })).not.toBe(v({}));
		// the sort angle matters only in line space
		expect(v({ angle: 45 })).toBe(v({}));
		expect(v({ caSpace: 'line', angle: 45 })).not.toBe(v({ caSpace: 'line', angle: 0 }));
	});
});
