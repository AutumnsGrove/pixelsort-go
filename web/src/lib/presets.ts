// Presets: the eight built-ins from the Python app as data (presets.json, in engine units: length per mille of the
// width, lo/hi 0..255), plus the helpers for rolling and saving user presets. Port of mockups/shared/presets.js.
//
// A preset is a *spec*, not a snapshot. Each field is one of:
//   5                      a fixed value
//   [lo, hi]               a number in lo..hi inclusive (or [lo, hi, step] to land on lo + n*step)
//   { pick: [...] }        one of these
//   { around: [v, spread] } an angle within +-spread degrees of v (wraps at 360)
// Applying a preset rolls every range, so "Main" is different each time. Presets hold the recipe only: never shapes,
// masks or the animation algorithm.
import data from './presets.json';
import type { Params } from './engine/params';

export type Spec = Record<
	string,
	number | string | boolean | number[] | { pick: (string | number)[] } | { around: [number, number] }
>;
export type Preset = { id: string; name: string; desc: string; spec: Spec };
export type Recipe = Pick<
	Params,
	'mode' | 'length' | 'randomness' | 'lo' | 'hi' | 'edge' | 'angle' | 'key' | 'reverse'
>;

export const BUILTIN: readonly Preset[] = data.presets as Preset[];
export const OWNED = data.owned as (keyof Recipe)[];
const INT_FIELDS = new Set(['length', 'randomness', 'lo', 'hi', 'edge', 'angle']);

/** Small deterministic generator, so tests (and "same seed, same roll") are reproducible. */
export function mulberry32(seed: number): () => number {
	let a = seed | 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function rollField(key: string, v: Spec[string], rnd: () => number): number | string | boolean {
	let out: number | string | boolean;
	if (Array.isArray(v)) {
		const [lo = 0, hi = 0, step = 1] = v;
		const n = Math.floor((hi - lo) / step + 1e-9);
		out = lo + Math.floor(rnd() * (n + 1)) * step;
	} else if (typeof v === 'object' && v !== null && 'pick' in v) {
		out = v.pick[Math.floor(rnd() * v.pick.length)] as string | number;
	} else if (typeof v === 'object' && v !== null && 'around' in v) {
		out = (((Math.round(v.around[0] + (rnd() * 2 - 1) * v.around[1]) % 360) + 360) % 360) as number;
	} else {
		out = v as number | string | boolean;
	}
	return typeof out === 'number' && INT_FIELDS.has(key) ? Math.round(out) : out;
}

/** Resolve a spec to concrete params. `base` fills every owned field the preset leaves out. */
export function roll(preset: Pick<Preset, 'spec'>, rnd: () => number = Math.random, base?: Partial<Recipe>): Recipe {
	const out: Record<string, unknown> = {};
	for (const k of OWNED) if (base && base[k] !== undefined) out[k] = base[k];
	out.reverse = false;
	for (const [k, v] of Object.entries(preset.spec)) out[k] = rollField(k, v, rnd);
	// A rolled upper threshold can land under the inherited lower one (Kims did, in Python too: an empty band sorts
	// nothing). Pull the lower one down so the band is never empty.
	const r = out as unknown as Recipe;
	if (r.lo > r.hi - 13) r.lo = Math.max(0, r.hi - 38);
	return r;
}

/** Does this preset roll anything? (decides whether "roll again" is offered) */
export function rolls(preset: Pick<Preset, 'spec'>): boolean {
	return Object.values(preset.spec).some(
		(v) => Array.isArray(v) || (typeof v === 'object' && v !== null && ('pick' in v || 'around' in v))
	);
}

function describeField(key: string, v: Spec[string]): string {
	if (Array.isArray(v)) return `${v[0]}–${v[1]}${key === 'angle' ? '°' : ''}`;
	if (typeof v === 'object' && v !== null && 'pick' in v) return 'any';
	if (typeof v === 'object' && v !== null && 'around' in v) return `±${v.around[1]}°`;
	return String(v);
}

/** The short chips on a preset card: its mode and its angle. */
export function chips(preset: Pick<Preset, 'spec'>): string[] {
	const s = preset.spec;
	const out: string[] = [];
	if (s.mode !== undefined) out.push(describeField('mode', s.mode));
	if (s.angle !== undefined) out.push(describeField('angle', s.angle) + (typeof s.angle === 'number' ? '°' : ''));
	return out;
}

/** Turn the current params into a user preset spec. `spread` makes it roll a little around those values. */
export function fromParams(p: Recipe, spread: boolean): Spec {
	const spec: Spec = {};
	for (const k of OWNED) spec[k] = p[k];
	if (spread) {
		spec.randomness = [Math.max(0, p.randomness - 10), Math.min(100, p.randomness + 10)];
		spec.length = [Math.max(1, Math.round(p.length * 0.7)), Math.round(p.length * 1.3)];
		spec.angle = { around: [p.angle, 20] };
	}
	return spec;
}

/** Which owned fields of `now` differ from the `applied` snapshot: drives the "edited" tag. */
export function diff(applied: Recipe | null | undefined, now: Recipe): (keyof Recipe)[] {
	return OWNED.filter((k) => applied && applied[k] !== now[k]);
}
