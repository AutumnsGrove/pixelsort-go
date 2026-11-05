// Export planning: pure functions. Port of mockups/shared/export-model.js.
//
// Memory model (PLAN.md section 3): a full-resolution export holds the decoded source and the output the whole time
// (4 B/px each); the sorter's scratch (keys, line index, interval table) is about 9 B/px, but only for the band being
// sorted. So `bands` shrinks the scratch, never the 8 B/px floor: a big enough picture cannot be exported on a small
// device at any band count, and the UI must say so. These numbers are ESTIMATES, not measurements.
import { slug } from './naming';

const FLOOR_BPP = 8;
const SCRATCH_BPP = 9;
export const BAND_STEPS = [1, 2, 4, 8, 16, 32, 64];
export const SCALES = [1, 0.75, 0.5, 0.25];

export type DeviceId = 'desktop' | 'phone';
export type FormatId = 'png' | 'jpeg' | 'webp';

// Deliberately conservative budgets: what one browser tab can reliably hold, not what the device has.
export const DEVICES: Record<DeviceId, { name: string; budgetMB: number }> = {
	desktop: { name: 'Desktop', budgetMB: 2000 },
	phone: { name: 'Phone', budgetMB: 300 }
};
export const FORMATS: Record<FormatId, { name: string; lossy: boolean; ext: string; note: string }> = {
	png: { name: 'PNG', lossy: false, ext: 'png', note: 'Lossless. Biggest files; exact pixels.' },
	jpeg: { name: 'JPEG', lossy: true, ext: 'jpg', note: 'Small and universal. No transparency.' },
	webp: { name: 'WebP', lossy: true, ext: 'webp', note: 'Smaller than JPEG at the same look.' }
};

export type Plan = {
	verdict: 'ok' | 'banded' | 'toolarge';
	bands: number;
	memMB: number;
	budgetMB: number;
	px: number;
	maxPx?: number;
};

/** Peak memory in MB for `px` pixels exported in `bands` bands. */
export const memoryMB = (px: number, bands: number): number => (px * (FLOOR_BPP + SCRATCH_BPP / bands)) / 1e6;

/** The fewest bands that fit the budget. verdict: ok (one pass) | banded | toolarge. */
export function plan(w: number, h: number, device: DeviceId): Plan {
	const dev = DEVICES[device] ?? DEVICES.desktop;
	const px = w * h;
	for (const n of BAND_STEPS) {
		const mb = memoryMB(px, n);
		if (mb <= dev.budgetMB)
			return { verdict: n === 1 ? 'ok' : 'banded', bands: n, memMB: mb, budgetMB: dev.budgetMB, px };
	}
	const last = BAND_STEPS[BAND_STEPS.length - 1] ?? 64;
	return {
		verdict: 'toolarge',
		bands: last,
		memMB: memoryMB(px, last),
		budgetMB: dev.budgetMB,
		px,
		maxPx: (dev.budgetMB * 1e6) / (FLOOR_BPP + SCRATCH_BPP / last)
	};
}

/** The largest scale (by linear factor) that fits, or null. */
export function suggestScale(w: number, h: number, device: DeviceId): number | null {
	for (const s of SCALES) if (plan(Math.round(w * s), Math.round(h * s), device).verdict !== 'toolarge') return s;
	return null;
}

/** Rough file size. PNG about 2.2 B/px on a sorted photo; JPEG scales with quality; WebP about 0.65x JPEG. */
export function estimateBytes(format: FormatId, quality: number, px: number): number {
	if (format === 'png') return px * 2.2;
	const jpeg = px * (0.15 + 0.0085 * quality);
	return format === 'webp' ? jpeg * 0.65 : jpeg;
}

export function fmtBytes(b: number): string {
	if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
	if (b >= 1e6) return (b / 1e6).toFixed(b >= 1e8 ? 0 : 1) + ' MB';
	return Math.max(1, Math.round(b / 1e3)) + ' KB';
}
export const fmtMP = (px: number): string => (px / 1e6).toFixed(px >= 1e7 ? 0 : 1) + ' MP';

/** A safe file name: name-recipe-tag.ext. */
export function filename(name: unknown, recipe: unknown, format: string, tag: unknown): string {
	const nm = slug(name);
	const rc = slug(recipe);
	const ext = (FORMATS as Record<string, { ext: string }>)[format]?.ext ?? 'png';
	return [nm || 'pixelsort', rc && !nm.includes(rc) ? rc : '', slug(tag)].filter(Boolean).join('-') + '.' + ext;
}

/** Line ranges for each band over `lines` scanlines. They cover 0..lines exactly. */
export function bandRanges(lines: number, bands: number): [number, number][] {
	return Array.from({ length: bands }, (_, i): [number, number] => [
		Math.floor((i * lines) / bands),
		Math.floor(((i + 1) * lines) / bands)
	]);
}
