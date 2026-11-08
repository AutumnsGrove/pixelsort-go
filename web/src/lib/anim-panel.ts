// Animation panel state: the export-only settings, the size estimate and the preview's frame arithmetic. Pure, so the
// component stays thin and these rules are tested without a browser.
import { frameCount, newSequence, type Ease, type Sequence } from './anim-sampler';
import { DEVICES, type DeviceId } from './export-model';
import { slug } from './naming';

export type AnimFormat = 'gif' | 'apng';

export type AnimSettings = {
	format: AnimFormat;
	scale: number;
	fps: number;
	durationSec: number;
	ease: Ease;
	holdMs: number;
	loop: boolean;
};

export const DEFAULT_ANIM: AnimSettings = {
	format: 'gif',
	scale: 1,
	fps: 24,
	durationSec: 4,
	ease: 'ease-out',
	holdMs: 500,
	loop: true
};

export const ANIM_SCALES = [1, 0.75, 0.5, 0.25] as const;
export const ANIM_FPS = [12, 15, 24, 30] as const;
export const ANIM_DURATIONS = [2, 3, 5, 8] as const;
export const ANIM_HOLDS = [0, 500, 1000] as const;
export const PREVIEW_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

export const ANIM_FORMATS: Record<AnimFormat, { name: string; ext: string; note: string }> = {
	gif: { name: 'GIF', ext: 'gif', note: 'Plays everywhere. 256 colours, so photos can band.' },
	apng: { name: 'APNG', ext: 'apng', note: 'Lossless and sharp. Bigger files than GIF.' }
};

/** The frame plan for these settings and a sort with `maxPasses` passes. */
export function sequenceFor(settings: AnimSettings, maxPasses: number): Sequence {
	return newSequence(maxPasses, Math.round(settings.durationSec * 1000), settings.fps, settings.holdMs, settings.ease);
}

/** How many frames the settings ask for, before the sort's pass count is known. */
export function frameCountFor(settings: AnimSettings): number {
	return frameCount(Math.round(settings.durationSec * 1000), settings.fps);
}

/** The written size in pixels, never below one. */
export function outputSize(w: number, h: number, scale: number): { w: number; h: number } {
	return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// Rough bytes a pixel costs in each format: GIF about 0.9 with one palette and dither; APNG about 2.5 with PNG compression.
const BYTES_PER_PX: Record<AnimFormat, number> = { gif: 0.9, apng: 2.5 };

/** A rough file size for warning before a long export, not a promise. */
export function estimateBytes(format: AnimFormat, frames: number, px: number): number {
	return Math.max(1024, Math.round(px * frames * BYTES_PER_PX[format]));
}

/** A plain warning when the encoder would hold more than half the device's budget, or null. */
export function memoryWarning(format: AnimFormat, frames: number, px: number, device: DeviceId): string | null {
	const bytes = estimateBytes(format, frames, px);
	const budget = DEVICES[device].budgetMB * 1e6;
	if (bytes < budget / 2) return null;
	return `About ${Math.round(bytes / 1e6)} MB in memory: too much for a ${DEVICES[device].name.toLowerCase()}. Try fewer frames, a shorter duration or a smaller scale.`;
}

/** The preview canvas keeps the export's shape but caps its long edge, so a 2 MP export does not draw a 2 MP canvas. */
export function previewSize(w: number, h: number, maxEdge = 520): { w: number; h: number } {
	const long = Math.max(w, h);
	if (long <= maxEdge) return { w, h };
	const k = maxEdge / long;
	return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Clamps a frame index to the list. */
export function clampFrame(index: number, frames: number): number {
	return Math.min(Math.max(0, Math.round(index)), Math.max(0, frames - 1));
}

/** The next frame for the playback loop; stops at the last frame when not looping. */
export function nextFrame(index: number, frames: number, loop: boolean): number {
	if (frames <= 0) return 0;
	if (index + 1 < frames) return index + 1;
	return loop ? 0 : frames - 1;
}

/** How long frame `index` stays on screen at a preview speed multiplier. */
export function previewDelay(delayMs: number, speed: number): number {
	return Math.max(16, Math.round(delayMs / Math.max(0.25, speed)));
}

/** A safe download name: name-anim.gif. */
export function animFilename(name: string, format: AnimFormat): string {
	const base = slug(name) || 'pixelsort';
	return `${base}-anim.${ANIM_FORMATS[format].ext}`;
}

/** Why these settings cannot be exported, or null. */
export function settingsProblem(settings: AnimSettings): string | null {
	if (!(settings.durationSec > 0)) return 'Choose a duration longer than zero.';
	if (settings.fps < 1 || settings.fps > 60) return 'The frame rate must be 1 to 60.';
	if (settings.scale <= 0 || settings.scale > 1) return 'The scale must be more than 0 and at most 100%.';
	return null;
}
