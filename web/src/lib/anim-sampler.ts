// Frame sampling for animation export: which pass each frame shows and how long it stays. Port of the Go sampler in
// internal/anim/sampler.go; the integer arithmetic is deliberate so both languages pick identical frames.
export type Ease = 'linear' | 'ease-out';

export const MIN_FRAMES = 2;
export const MAX_FRAMES = 1200;
export const MAX_FPS = 60;
const MAX_DURATION_MS = 600_000;

/** duration x fps, rounded, kept between MIN_FRAMES and MAX_FRAMES; bad numbers give MIN_FRAMES. */
export function frameCount(durationMs: number, fps: number): number {
	if (durationMs <= 0 || fps <= 0) return MIN_FRAMES;
	const d = Math.min(MAX_DURATION_MS, durationMs);
	const f = Math.min(MAX_FPS, fps);
	const n = Math.floor((d * f + 500) / 1000);
	return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, n));
}

/**
 * `frames` pass numbers from 0 to `total`, non-decreasing, starting at the original and ending at the finished sort.
 * With more frames than passes (a merge sort can have ten), passes repeat and easing falls back to linear so the
 * repeats are spread evenly instead of piling up at the end.
 */
export function sample(total: number, frames: number, ease: Ease): number[] {
	const n = Math.max(MIN_FRAMES, frames);
	const t = Math.max(0, total);
	const out = new Array<number>(n).fill(0);
	const den = n - 1;
	if (t === 0) return out;
	const strict = n <= t + 1;
	if (ease === 'ease-out' && strict) {
		// p = round(t * (1 - (1 - i/den)^2)) = round(t * i * (2*den - i) / den^2)
		const sq = den * den;
		for (let i = 0; i < n; i++) out[i] = Math.floor((t * i * (2 * den - i) + Math.floor(sq / 2)) / sq);
	} else {
		for (let i = 0; i < n; i++) out[i] = Math.floor((t * i + Math.floor(den / 2)) / den);
	}
	if (strict) {
		// Rounding can put two frames on the same pass; nudge them apart from both ends.
		for (let i = 1; i < n; i++) out[i] = Math.max(out[i] ?? 0, (out[i - 1] ?? 0) + 1);
		out[n - 1] = t;
		for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i] ?? 0, (out[i + 1] ?? 0) - 1);
	}
	out[0] = 0;
	out[n - 1] = t;
	return out;
}

/** A complete frame plan: the pass each frame shows and its delay in milliseconds. */
export type Sequence = {
	passes: number[];
	delaysMs: number[];
	ease: Ease;
	fps: number;
};

/** Builds the plan for a sort with `total` passes (the engine's MaxPasses). */
export function newSequence(total: number, durationMs: number, fps: number, holdMs: number, ease: Ease): Sequence {
	const f = Math.min(MAX_FPS, Math.max(1, fps));
	const frames = frameCount(durationMs, f);
	const used: Ease = ease === 'ease-out' && frames <= total + 1 ? 'ease-out' : 'linear';
	const passes = sample(total, frames, used);
	const base = Math.max(1, Math.floor(1000 / f));
	const delaysMs = new Array<number>(frames).fill(base);
	if (holdMs > 0) delaysMs[frames - 1] = (delaysMs[frames - 1] ?? base) + holdMs;
	return { passes, delaysMs, ease: used, fps: f };
}
