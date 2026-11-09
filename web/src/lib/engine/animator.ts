// Pure pacing for the animation loop: how many passes to run this frame. The worker calls it; nothing here touches
// the engine, so it is easy to test.

export const MAX_DT_SECONDS = 0.1; // a stalled tab must not fast-forward the whole sort in one frame
export const MAX_STEPS_PER_FRAME = 300;
export const TARGET_FRAME_MS = 16;

export type Speed = number | 'auto';

/** Fixed speed: carry fractional steps between frames (a port of play() in the mockup). */
export function fixedSteps(dtSeconds: number, speed: number, carry: number): { steps: number; carry: number } {
	const acc = carry + Math.min(MAX_DT_SECONDS, Math.max(0, dtSeconds)) * speed;
	const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(acc));
	// If the cap bit, drop the excess instead of paying it back later as a burst.
	const rest = steps === MAX_STEPS_PER_FRAME ? 0 : acc - steps;
	return { steps, carry: rest };
}

/** Auto-fit: adjust steps per frame so a batch takes about one frame; changes at most x2 or /2 per frame. */
export function adaptAuto(currentSteps: number, batchMs: number): number {
	const wanted = (currentSteps * TARGET_FRAME_MS) / Math.max(0.05, batchMs);
	const bounded = Math.min(currentSteps * 2, Math.max(currentSteps / 2, wanted));
	return Math.min(MAX_STEPS_PER_FRAME, Math.max(1, Math.round(bounded)));
}

// ---- the loop: what the animation does when the sort reaches the end ----

/** Where the animation goes once the sort reaches its last pass. */
export function afterSort(loop: boolean): 'stop' | 'back' {
	return loop ? 'back' : 'stop';
}

/** The pass a rewind frame lands on: closer to the original by `steps`, and never past it. */
export function rewindTarget(pass: number, steps: number): number {
	return Math.max(0, pass - Math.max(1, Math.floor(steps)));
}

/** Whether a rewind has reached the original, so the loop turns forward again. */
export function rewindDone(pass: number): boolean {
	return pass <= 0;
}
