// Settings: what the Settings page stores. Pure helpers plus defaults; the reactive store is settings.svelte.ts.
// Port of mockups/shared/settings.js.
import {
	ANIM_DURATIONS,
	ANIM_FORMATS,
	ANIM_FPS,
	ANIM_HOLDS,
	ANIM_SCALES,
	DEFAULT_ANIM,
	type AnimFormat,
	type AnimSettings
} from './anim-panel';

export const WORK_RES = [960, 1280, 1920, 2560] as const;
export const DEVICE_RES = { desktop: 1920, phone: 1280 } as const;

export type Settings = {
	workRes: number | null;
	exportFormat: 'png' | 'jpeg' | 'webp';
	exportQuality: number;
	stripMeta: boolean;
	embedRecipe: boolean;
	shareExpiry: 'never' | '30';
	grain: boolean;
	motion: 'system' | 'reduce';
	/** How fast the stepped sort runs in Studio, in passes a second. */
	speed: number;
	/** Loop the stepped sort: it walks back to the original and starts again. */
	loop: boolean;
	/** The animation panel's export settings, remembered so the next export starts where the last one left off. */
	anim: AnimSettings;
	/** Store a run by itself when a sort settles (off by default: nothing is stored until Save or Export). */
	autoSave: boolean;
	/** The Shape helper's first-use notice has been shown on this device (Settings can show it again). */
	helperNoticeSeen: boolean;
};

export const DEFAULTS: Settings = {
	workRes: null,
	exportFormat: 'png',
	exportQuality: 92,
	stripMeta: true,
	embedRecipe: true,
	shareExpiry: '30',
	grain: true,
	motion: 'system',
	speed: 40,
	loop: false,
	anim: { ...DEFAULT_ANIM },
	autoSave: false,
	helperNoticeSeen: false
};

const num = (v: unknown, lo: number, hi: number): number | null => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
};

/** Keep only known keys with valid values; anything else is dropped, so a corrupt store cannot break a page. */
export function sanitize(input: unknown): Partial<Settings> {
	const out: Partial<Settings> = {};
	const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
	if ('workRes' in o && (o.workRes === null || (WORK_RES as readonly unknown[]).includes(o.workRes)))
		out.workRes = o.workRes as number | null;
	if (o.exportFormat === 'png' || o.exportFormat === 'jpeg' || o.exportFormat === 'webp')
		out.exportFormat = o.exportFormat;
	const q = 'exportQuality' in o ? num(o.exportQuality, 40, 100) : null;
	if (q !== null) out.exportQuality = q;
	const sp = 'speed' in o ? num(o.speed, 1, 400) : null;
	if (sp !== null) out.speed = sp;
	for (const k of ['stripMeta', 'embedRecipe', 'grain', 'autoSave', 'helperNoticeSeen', 'loop'] as const)
		if (typeof o[k] === 'boolean') out[k] = o[k];
	const anim = sanitizeAnim(o.anim);
	if (anim) out.anim = anim;
	if (o.shareExpiry === 'never' || o.shareExpiry === '30') out.shareExpiry = o.shareExpiry;
	if (o.motion === 'system' || o.motion === 'reduce') out.motion = o.motion;
	return out;
}

/** Scale (w, h) so the long edge is at most `long`; never upscale; keep the aspect ratio. */
export function workCopy(w: number, h: number, long: number): { w: number; h: number; scaled: boolean } {
	const k = Math.min(1, long / Math.max(w, h));
	return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: k < 1 };
}

/** The long edge of the working copy: the chosen one, else the device default. */
export function workRes(s: Settings, device: keyof typeof DEVICE_RES): number {
	return s.workRes ?? DEVICE_RES[device] ?? DEVICE_RES.desktop;
}

/** One of the panel's choices, kept only if it is one the panel offers; anything else falls back to the default. */
function pick<T>(allowed: readonly T[], v: unknown, fallback: T): T {
	return (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
}

/**
 * The animation panel's remembered settings, field by field, so one bad value cannot lose the rest. A store written by an
 * older version simply keeps the settings it still recognises.
 */
export function sanitizeAnim(input: unknown): AnimSettings | null {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const o = input as Record<string, unknown>;
	return {
		format: pick(Object.keys(ANIM_FORMATS) as AnimFormat[], o.format, DEFAULT_ANIM.format),
		scale: pick(ANIM_SCALES, o.scale, DEFAULT_ANIM.scale),
		fps: pick(ANIM_FPS, o.fps, DEFAULT_ANIM.fps),
		durationSec: pick(ANIM_DURATIONS, o.durationSec, DEFAULT_ANIM.durationSec),
		ease: pick(['linear', 'ease-out'], o.ease, DEFAULT_ANIM.ease),
		holdMs: pick(ANIM_HOLDS, o.holdMs, DEFAULT_ANIM.holdMs),
		loop: typeof o.loop === 'boolean' ? o.loop : DEFAULT_ANIM.loop,
		mode: pick(['once', 'infinity'], o.mode, DEFAULT_ANIM.mode)
	};
}
