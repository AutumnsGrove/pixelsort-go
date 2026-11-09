import { describe, expect, it } from 'vitest';
import { MAX_FRAMES, frameCount, newSequence, sample, type Ease } from '#lib/anim-sampler';

// These cases are shared with the Go sampler (internal/anim/sampler_test.go): the CLI and the studio must pick the
// same frames for the same recipe settings.
const vectors: { total: number; frames: number; ease: Ease; want: number[] }[] = [
	{ total: 4, frames: 5, ease: 'linear', want: [0, 1, 2, 3, 4] },
	{ total: 10, frames: 4, ease: 'linear', want: [0, 3, 7, 10] },
	{ total: 100, frames: 3, ease: 'ease-out', want: [0, 75, 100] },
	{ total: 2, frames: 7, ease: 'ease-out', want: [0, 0, 1, 1, 1, 2, 2] },
	{ total: 0, frames: 4, ease: 'linear', want: [0, 0, 0, 0] },
	{ total: 3, frames: 4, ease: 'ease-out', want: [0, 1, 2, 3] }
];

describe('frameCount', () => {
	it('is duration times frame rate, rounded', () => {
		expect(frameCount(5000, 30)).toBe(150);
		expect(frameCount(2000, 24)).toBe(48);
		expect(frameCount(1000, 25)).toBe(25);
	});

	it('never asks for fewer than two frames', () => {
		expect(frameCount(10, 1)).toBe(2);
		expect(frameCount(-5, 30)).toBe(2);
		expect(frameCount(5000, 0)).toBe(2);
	});

	it('caps a runaway duration', () => {
		expect(frameCount(10_000_000, 60)).toBe(MAX_FRAMES);
	});
});

describe('sample', () => {
	it.each(vectors)('total $total, $frames frames, $ease = $want', ({ total, frames, ease, want }) => {
		expect(sample(total, frames, ease)).toEqual(want);
	});

	it('starts at the original and ends at the finished sort', () => {
		for (const v of vectors) {
			const passes = sample(v.total, v.frames, v.ease);
			expect(passes[0]).toBe(0);
			expect(passes[passes.length - 1]).toBe(v.total);
			expect(passes).toHaveLength(v.frames);
		}
	});

	it('never goes backwards', () => {
		const passes = sample(500, 97, 'ease-out');
		for (let i = 1; i < passes.length; i++) expect(passes[i]).toBeGreaterThanOrEqual(passes[i - 1] ?? 0);
	});

	it('visits a new pass every frame when there are enough passes', () => {
		const passes = sample(500, 97, 'ease-out');
		for (let i = 1; i < passes.length; i++) expect(passes[i]).toBeGreaterThan(passes[i - 1] ?? 0);
	});
});

describe('newSequence', () => {
	it('gives every frame a delay and adds the hold to the last', () => {
		const seq = newSequence(10, 1000, 10, 250, 'linear');
		expect(seq.passes).toHaveLength(10);
		expect(seq.delaysMs).toHaveLength(10);
		expect(seq.delaysMs[0]).toBe(100);
		expect(seq.delaysMs[9]).toBe(350);
	});

	it('falls back to linear for an unknown easing', () => {
		const seq = newSequence(10, 1000, 10, 0, 'nonsense' as Ease);
		expect(seq.passes).toEqual(sample(10, 10, 'linear'));
		expect(seq.ease).toBe('linear');
	});
});
