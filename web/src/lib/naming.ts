// Names: tidy what a person typed, suggest an automatic name, and build file names. Pure. Port of
// mockups/shared/naming.js (without its DOM control, which becomes a Svelte component).

export const MAX = 60;
const WORDS = [
	'Ridge',
	'Dusk',
	'Static',
	'Heat',
	'Curtain',
	'Embers',
	'Rain',
	'Skyline',
	'Ash',
	'Glass',
	'Tide',
	'Dune',
	'Noise',
	'Fall'
];
const MODE: Record<string, string> = {
	random: 'random',
	wave: 'waves',
	threshold: 'threshold',
	edges: 'edges',
	ca: 'cellular',
	'ca-edges': 'cellular',
	none: 'plain'
};
// Control characters and invisible/direction-override characters are the point of this pattern.
/* eslint-disable no-control-regex, no-irregular-whitespace */
const STRIP = /[\u0000-\u001f\u007f-\u009f ​-‏‪-‮⁦-⁩﻿]/g;
/* eslint-enable no-control-regex, no-irregular-whitespace */

/** What was typed, made safe to keep: control and invisible characters become spaces, ends trimmed, 60 code points. */
export function clean(text: unknown): string {
	let s = String(text ?? '')
		.replace(STRIP, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const c = Array.from(s);
	if (c.length > MAX) s = c.slice(0, MAX).join('').trim();
	return s;
}

function hash(t: unknown): number {
	let h = 2166136261;
	for (const ch of String(t)) {
		h ^= ch.codePointAt(0) ?? 0;
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** The automatic name: a word picked from the seed, then the mode. Stable for the same inputs. */
export function suggest(
	params: { mode?: string; rule?: number; seed?: number } | null | undefined,
	seed?: number | string
): string {
	const p = params ?? {};
	const word = WORDS[hash(seed ?? p.seed ?? 0) % WORDS.length] ?? 'Ridge';
	const mode = MODE[String(p.mode)] ?? String(p.mode ?? 'random');
	return word + ', ' + mode + ((p.mode === 'ca' || p.mode === 'ca-edges') && p.rule != null ? ' ' + p.rule : '');
}

/** Typed text becomes the name to keep. An empty entry goes back to `fallback`, so a name is never blank. */
export function resolve(typed: unknown, fallback: unknown): { name: string; kept: boolean; cleared: boolean } {
	const c = clean(typed);
	const fb = clean(fallback) || 'Untitled';
	return c ? { name: c, kept: true, cleared: false } : { name: fb, kept: false, cleared: true };
}

export function slug(s: unknown): string {
	return String(s ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

/** name-recipe-tag.ext, with the recipe word dropped when the name already says it. */
export function fileName(name: unknown, recipe: unknown, format: string, tag: unknown): string {
	const nm = slug(name);
	const rc = slug(recipe);
	return (
		[nm || 'pixelsort', rc && !nm.includes(rc) ? rc : '', slug(tag)].filter(Boolean).join('-') +
		'.' +
		(EXT[format] ?? 'png')
	);
}

/** A store of names by run id, as read from storage: only sane keys and cleaned, non-empty strings survive. */
export function sanitizeAll(o: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
	for (const [k, v] of Object.entries(o)) {
		if (/^[\w-]{1,40}$/.test(k) && typeof v === 'string') {
			const c = clean(v);
			if (c) out[k] = c;
		}
	}
	return out;
}
