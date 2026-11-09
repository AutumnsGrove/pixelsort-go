import { describe, expect, it } from 'vitest';
import {
	ANIM_FORMATS,
	ANIM_MODES,
	DEFAULT_ANIM,
	animFilename,
	clampFrame,
	evenSize,
	estimateBytes,
	frameCountFor,
	loopsByItself,
	memoryRefusal,
	memoryWarning,
	nextFrame,
	outputSize,
	previewDelay,
	previewSize,
	sequenceFor,
	settingsProblem,
	type AnimSettings
} from '#lib/anim-panel';

const base: AnimSettings = { ...DEFAULT_ANIM };

describe('animation settings', () => {
	it('has a format note for each format', () => {
		expect(ANIM_FORMATS.gif.name).toBe('GIF');
		expect(ANIM_FORMATS.apng.ext).toBe('apng');
		expect(ANIM_FORMATS.mp4.ext).toBe('mp4');
		expect(ANIM_FORMATS.webm.ext).toBe('webm');
	});

	it('turns seconds into frames', () => {
		expect(frameCountFor({ ...base, durationSec: 2, fps: 24 })).toBe(48);
		expect(frameCountFor({ ...base, durationSec: 4, fps: 12 })).toBe(48);
	});

	it('builds the same sequence the export walks', () => {
		const seq = sequenceFor({ ...base, durationSec: 2, fps: 10, holdMs: 250 }, 50);
		expect(seq.passes[0]).toBe(0);
		expect(seq.passes[seq.passes.length - 1]).toBe(50);
	});

	it('is a one-way sort unless Infinity is chosen', () => {
		expect(DEFAULT_ANIM.mode).toBe('once');
		expect(ANIM_MODES.infinity.name).toBe('Infinity');
		const seq = sequenceFor({ ...base, durationSec: 2, fps: 10 }, 50);
		expect(seq.passes[seq.passes.length - 1]).toBe(50);
	});

	it('walks back to the original in Infinity mode', () => {
		const seq = sequenceFor({ ...base, durationSec: 2, fps: 10, mode: 'infinity' }, 50);
		expect(seq.passes[0]).toBe(0);
		// The finished picture is the top of the loop and the last frame is on its way back down.
		expect(Math.max(...seq.passes)).toBe(50);
		expect(seq.passes[seq.passes.length - 1]).toBeLessThan(50);
		expect(seq.passes[seq.passes.length - 1]).toBeGreaterThan(0);
	});

	it('loops videos whether or not the GIF setting was turned off', () => {
		// A GIF with Loop off, then switched to MP4: our viewers always loop a video, so the sequence must not close.
		expect(loopsByItself({ ...base, loop: false })).toBe(false);
		expect(loopsByItself({ ...base, loop: false, format: 'mp4' })).toBe(true);
		expect(loopsByItself({ ...base, loop: false, format: 'webm' })).toBe(true);
		expect(loopsByItself({ ...base, loop: false, format: 'apng' })).toBe(false);

		const still = { ...base, mode: 'infinity' as const, durationSec: 2, fps: 10 };
		expect(sequenceFor({ ...still, format: 'mp4', loop: false }, 50).passes).toEqual(
			sequenceFor({ ...still, format: 'mp4', loop: true }, 50).passes
		);
		expect(sequenceFor({ ...still, format: 'gif', loop: false }, 50).passes).toHaveLength(
			sequenceFor({ ...still, format: 'gif', loop: true }, 50).passes.length + 1
		);
	});

	it('reports impossible settings', () => {
		expect(settingsProblem(base)).toBeNull();
		expect(settingsProblem({ ...base, durationSec: 0 })).toContain('duration');
		expect(settingsProblem({ ...base, fps: 0 })).toContain('frame rate');
		expect(settingsProblem({ ...base, scale: 2 })).toContain('scale');
	});
});

describe('size and memory', () => {
	it('scales the output', () => {
		expect(outputSize(1600, 1200, 0.5)).toEqual({ w: 800, h: 600 });
		expect(outputSize(1, 1, 0.25)).toEqual({ w: 1, h: 1 });
	});

	it('rounds video down to even dimensions', () => {
		expect(evenSize(1200, 675)).toEqual({ w: 1200, h: 674 });
		expect(evenSize(1, 1)).toEqual({ w: 2, h: 2 });
	});

	it('estimates APNG larger than GIF, and video smaller than both', () => {
		expect(estimateBytes('apng', 100, 1e6)).toBeGreaterThan(estimateBytes('gif', 100, 1e6));
		expect(estimateBytes('mp4', 100, 1e6)).toBeLessThan(estimateBytes('gif', 100, 1e6));
	});

	it('warns when the file would be too big to hold', () => {
		expect(memoryWarning('gif', 10, 1000, 'desktop')).toBeNull();
		expect(memoryWarning('apng', 1200, 8e6, 'phone')).toContain('too much');
	});

	it('refuses an export that cannot fit at all', () => {
		expect(memoryRefusal('gif', 10, 1000, 'desktop')).toBeNull();
		const refusal = memoryRefusal('apng', 1200, 8e6, 'phone');
		expect(refusal).toContain('more than');
	});

	it('caps the preview canvas but keeps its shape', () => {
		expect(previewSize(1600, 800)).toEqual({ w: 520, h: 260 });
		expect(previewSize(400, 300)).toEqual({ w: 400, h: 300 });
	});
});

describe('playback arithmetic', () => {
	it('clamps frames to the list', () => {
		expect(clampFrame(-3, 10)).toBe(0);
		expect(clampFrame(99, 10)).toBe(9);
		expect(clampFrame(4.4, 10)).toBe(4);
	});

	it('loops or stops at the end', () => {
		expect(nextFrame(8, 10, true)).toBe(9);
		expect(nextFrame(9, 10, true)).toBe(0);
		expect(nextFrame(9, 10, false)).toBe(9);
	});

	it('speeds delays up but never below one frame', () => {
		expect(previewDelay(100, 2)).toBe(50);
		expect(previewDelay(100, 0.5)).toBe(200);
		expect(previewDelay(1, 4)).toBe(16);
	});

	it('names the file after the picture', () => {
		expect(animFilename('Autumn’s Ridge', 'apng')).toBe('autumn-s-ridge-anim.apng');
		expect(animFilename('', 'gif')).toBe('pixelsort-anim.gif');
	});
});
