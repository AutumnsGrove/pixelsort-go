import { describe, expect, it } from 'vitest';
import { MAX_FRAMES, frameCount, newSequence, roundTrip, sample, type Ease } from '#lib/anim-sampler';

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
		const seq = newSequence(10, 1000, 10, 250, 'linear', 'once', true);
		expect(seq.passes).toHaveLength(10);
		expect(seq.delaysMs).toHaveLength(10);
		expect(seq.delaysMs[0]).toBe(100);
		expect(seq.delaysMs[9]).toBe(350);
	});

	it('falls back to linear for an unknown easing', () => {
		const seq = newSequence(10, 1000, 10, 0, 'nonsense' as Ease, 'once', true);
		expect(seq.passes).toEqual(sample(10, 10, 'linear'));
		expect(seq.ease).toBe('linear');
	});

	it('does not turn a once sequence into a loop', () => {
		const seq = newSequence(10, 1000, 10, 250, 'linear', 'once', true);
		expect(seq.passes).toEqual(sample(10, 10, 'linear'));
	});

	it('splits the duration between the two legs in infinity mode', () => {
		const once = newSequence(500, 4000, 24, 0, 'linear', 'once', true);
		const loop = newSequence(500, 4000, 24, 0, 'linear', 'infinity', true);
		// The loop lasts as long as the setting says, so it has about as many frames as the once export.
		expect(once.passes.length).toBe(96);
		expect(loop.passes.length).toBe(94);
	});

	it('still finishes an infinity loop that has nothing to sort', () => {
		const seq = newSequence(0, 1000, 10, 100, 'linear', 'infinity', true);
		expect(seq.passes.every((p) => p === 0)).toBe(true);
	});
});

describe('roundTrip', () => {
	// Ten frames a second, so a frame lasts 100 ms whatever the frame count works out to.
	const forward = (total: number, frames: number): ReturnType<typeof newSequence> =>
		newSequence(total, frames * 100, 10, 100, 'linear', 'once', true);

	it('walks the passes back to the first', () => {
		const fwd = forward(4, 5); // passes 0..4
		const loop = roundTrip(fwd, 0, true);
		expect(loop.passes).toEqual([0, 1, 2, 3, 4, 3, 2, 1]);
		expect(loop.delaysMs).toHaveLength(loop.passes.length);
	});

	it('drops both turnaround frames so no frame is shown twice', () => {
		const loop = roundTrip(forward(4, 5), 0, true);
		expect(loop.passes.filter((p) => p === 0)).toHaveLength(1);
		expect(loop.passes.filter((p) => p === 4)).toHaveLength(1);
		for (let i = 1; i < loop.passes.length; i++) expect(loop.passes[i]).not.toBe(loop.passes[i - 1]);
	});

	it('drops repeated endpoints too, when there are more frames than passes', () => {
		// A three-pass sort over seven frames repeats every pass; the loop must not show four of one at the turnaround.
		const fwd = forward(2, 7);
		expect(fwd.passes).toEqual([0, 0, 1, 1, 1, 2, 2]);
		expect(roundTrip(fwd, 0, true).passes).toEqual([0, 0, 1, 1, 1, 2, 2, 1, 1, 1]);
	});

	it('holds at both ends of the loop, not on the way past', () => {
		const loop = roundTrip(forward(4, 5), 100, true);
		// Frame 0 is the original and frame 4 the finished picture; the last frame is on its way back.
		expect(loop.delaysMs[0]).toBe(200);
		expect(loop.delaysMs[4]).toBe(200);
		expect(loop.delaysMs[loop.delaysMs.length - 1]).toBe(100);
	});

	it('closes the loop with the original when the animation will not repeat', () => {
		const loop = roundTrip(forward(4, 5), 100, false);
		expect(loop.passes[loop.passes.length - 1]).toBe(0);
		expect(loop.delaysMs[loop.delaysMs.length - 1]).toBe(200);
		expect(roundTrip(forward(4, 5), 100, true).passes).toHaveLength(loop.passes.length - 1);
	});

	it('is its own mirror when every pass gets its own frame', () => {
		for (const [total, frames] of [
			[1, 2],
			[2, 3],
			[7, 8],
			[40, 9],
			[300, 2],
			[300, 50]
		] as const) {
			const fwd = forward(total, frames);
			// The premise: enough passes for every frame to be a new one, so nothing is dropped but the two endpoints.
			expect(fwd.passes.every((p, i) => i === 0 || p > (fwd.passes[i - 1] ?? 0))).toBe(true);
			const loop = roundTrip(fwd, 0, true);
			expect(loop.passes[0]).toBe(0);
			expect(Math.max(...loop.passes)).toBe(total);
			// From the turnaround outwards, the two legs are the same passes.
			const n = fwd.passes.length;
			for (let k = 1; k < n - 1; k++) expect(loop.passes[loop.passes.length - k]).toBe(fwd.passes[k]);
		}
	});
});
